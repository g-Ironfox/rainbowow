import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

import redis.asyncio as redis
from bson import ObjectId
from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, field_validator


HEARTBEAT_TIMEOUT = 60
BASE_DIR = Path(__file__).resolve().parent


class CrawlerCreate(BaseModel):
    crawler_id: str = Field(min_length=1, max_length=64)
    user_data_dir: str = Field(min_length=1, max_length=256)
    image_strategy: str = Field(default="None", max_length=64)

    @field_validator("crawler_id", "user_data_dir", "image_strategy")
    @classmethod
    def strip_value(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value


class GotoAction(BaseModel):
    url: str = Field(min_length=1, max_length=2048)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        value = value.strip()
        if not value.startswith(("http://", "https://")):
            raise ValueError("URL 必须以 http:// 或 https:// 开头")
        return value


def serialize_document(document: dict) -> dict:
    result = dict(document)
    result["_id"] = str(result["_id"])
    return result


def crawler_status(last_log: dict | None, now: float | None = None) -> str:
    if not last_log or last_log.get("message") in {"Created", "Terminated"}:
        return "stopped"
    if last_log.get("timestamp", 0) < (now or time.time()) - HEARTBEAT_TIMEOUT:
        return "error"
    if last_log.get("message") in {"Idle", "Waiting"}:
        return "idle"
    return "running"


@asynccontextmanager
async def lifespan(app: FastAPI):
    mongo_host = os.getenv("MONGO_HOST", "mongodb")
    mongo_port = os.getenv("MONGO_PORT", "27017")
    mongo_user = os.getenv("MONGO_USER", "root")
    mongo_password = os.getenv("MONGO_PASS", "114515")
    mongo_db = os.getenv("MONGO_DB", "rainbow1")

    mongo_uri = f"mongodb://{mongo_user}:{mongo_password}@{mongo_host}:{mongo_port}/admin"
    app.state.mongo = AsyncIOMotorClient(mongo_uri, serverSelectionTimeoutMS=5000)
    app.state.db = app.state.mongo[mongo_db]
    app.state.redis = redis.Redis(
        host=os.getenv("REDIS_HOST", "redis"),
        port=int(os.getenv("REDIS_PORT", "6379")),
        decode_responses=True,
    )
    yield
    await app.state.redis.aclose()
    app.state.mongo.close()


app = FastAPI(title="Rainbow Crawler WebUI", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/health")
async def health(request: Request):
    try:
        await request.app.state.mongo.admin.command("ping")
        await request.app.state.redis.ping()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"依赖服务不可用: {exc}") from exc
    return {"status": "ok"}


@app.get("/api/crawlers")
async def list_crawlers(request: Request):
    crawlers = await request.app.state.db.crawlers.find().sort("crawler_id", 1).to_list(None)
    result = []
    for crawler in crawlers:
        last_log = await request.app.state.db.log.find_one(
            {"crawler_id": crawler["crawler_id"]}, sort=[("timestamp", -1)]
        )
        item = serialize_document(crawler)
        item["status"] = crawler_status(last_log)
        item["last_log"] = serialize_document(last_log) if last_log else None
        result.append(item)
    return result


@app.post("/api/crawlers", status_code=status.HTTP_201_CREATED)
async def create_crawler(payload: CrawlerCreate, request: Request):
    crawlers = request.app.state.db.crawlers
    if await crawlers.find_one({"crawler_id": payload.crawler_id}):
        raise HTTPException(status_code=409, detail="爬虫 ID 已存在")

    document = payload.model_dump()
    result = await crawlers.insert_one(document)
    await request.app.state.db.log.insert_one(
        {"crawler_id": payload.crawler_id, "message": "Created", "timestamp": time.time()}
    )
    return {**document, "_id": str(result.inserted_id), "status": "stopped"}


async def require_crawler(request: Request, crawler_id: str) -> dict:
    crawler = await request.app.state.db.crawlers.find_one({"crawler_id": crawler_id})
    if not crawler:
        raise HTTPException(status_code=404, detail="爬虫不存在")
    return crawler


@app.post("/api/crawlers/{crawler_id}/launch")
async def launch_crawler(crawler_id: str, request: Request):
    await require_crawler(request, crawler_id)
    last_log = await request.app.state.db.log.find_one(
        {"crawler_id": crawler_id}, sort=[("timestamp", -1)]
    )
    current_status = crawler_status(last_log)
    if current_status in {"running", "idle"}:
        raise HTTPException(status_code=409, detail="爬虫已在运行")
    await request.app.state.redis.rpush("crawler_queue", crawler_id)
    return {"message": "启动任务已入队"}


@app.post("/api/crawlers/{crawler_id}/terminate")
async def terminate_crawler(crawler_id: str, request: Request):
    await require_crawler(request, crawler_id)
    last_log = await request.app.state.db.log.find_one(
        {"crawler_id": crawler_id}, sort=[("timestamp", -1)]
    )
    if crawler_status(last_log) not in {"running", "idle"}:
        raise HTTPException(status_code=409, detail="爬虫当前未运行")
    await request.app.state.redis.lpush(f"Action_Queue_{crawler_id}", "TERMINATE")
    return {"message": "停止事件已发送"}


async def enqueue_action(request: Request, crawler_id: str, action: str, args: dict | None = None):
    await require_crawler(request, crawler_id)
    document = {
        "crawler_id": crawler_id,
        "action": action,
        "timestamp": time.time(),
    }
    if args:
        document["args"] = args
    result = await request.app.state.db.action.insert_one(document)
    await request.app.state.redis.rpush(f"Action_Queue_{crawler_id}", str(result.inserted_id))
    return {"message": "动作已入队", "action_id": str(result.inserted_id)}


@app.post("/api/crawlers/{crawler_id}/actions/surface")
async def surface(crawler_id: str, request: Request):
    return await enqueue_action(request, crawler_id, "surface")


@app.post("/api/crawlers/{crawler_id}/actions/screenshot")
async def screenshot(crawler_id: str, request: Request):
    return await enqueue_action(request, crawler_id, "screenshot")


@app.post("/api/crawlers/{crawler_id}/actions/goto")
async def goto(crawler_id: str, payload: GotoAction, request: Request):
    return await enqueue_action(request, crawler_id, "goto", {"url": payload.url})


@app.get("/api/logs")
async def list_logs(
    request: Request,
    crawler_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
):
    query = {"crawler_id": crawler_id} if crawler_id else {}
    logs = await request.app.state.db.log.find(query).sort("timestamp", -1).limit(limit).to_list(limit)
    return [serialize_document(log) for log in logs]


@app.get("/api/actions/{action_id}")
async def get_action(action_id: str, request: Request):
    try:
        object_id = ObjectId(action_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="无效的动作 ID") from exc
    action = await request.app.state.db.action.find_one({"_id": object_id})
    if not action:
        raise HTTPException(status_code=404, detail="动作不存在")
    return serialize_document(action)