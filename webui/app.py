import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

import redis.asyncio as redis
from bson import ObjectId
from fastapi import FastAPI, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, field_validator, model_validator


BASE_DIR = Path(__file__).resolve().parent


class ProxyConfig(BaseModel):
    url: str = Field(default="", max_length=2048)
    user: str = Field(default="", max_length=256)
    password: str = Field(default="", max_length=256)

    @field_validator("url", "user")
    @classmethod
    def strip_value(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def validate_credentials(self):
        if not self.url and (self.user or self.password):
            raise ValueError("填写代理账号或密码时必须填写代理 URL")
        return self


class CrawlerCreate(BaseModel):
    crawler_id: str = Field(min_length=1, max_length=64)
    user_data_dir: str = Field(min_length=1, max_length=256)
    image_strategy: Literal["none", "ban", "blank", "cache"] = "none"
    wait_base_seconds: float = Field(default=5, ge=0, le=300)
    wait_random_rate: float = Field(default=0.6, ge=0, le=10)
    wait_initial_multiplier: float = Field(default=1.0, ge=0, le=10)
    wait_scroll_multiplier: float = Field(default=0.8, ge=0, le=10)
    wait_post_multiplier: float = Field(default=0.4, ge=0, le=10)
    wait_detail_open_multiplier: float = Field(default=0.6, ge=0, le=10)
    wait_detail_close_multiplier: float = Field(default=0.6, ge=0, le=10)
    wait_error_multiplier: float = Field(default=0.6, ge=0, le=10)
    proxy: ProxyConfig = Field(default_factory=ProxyConfig)

    @field_validator("crawler_id", "user_data_dir")
    @classmethod
    def strip_value(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value


class CrawlerUpdate(BaseModel):
    user_data_dir: str = Field(min_length=1, max_length=256)
    image_strategy: Literal["none", "ban", "blank", "cache"] = "none"
    proxy: ProxyConfig = Field(default_factory=ProxyConfig)

    @field_validator("user_data_dir")
    @classmethod
    def strip_value(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("不能为空")
        return value


class CrawlerTimingUpdate(BaseModel):
    wait_base_seconds: float = Field(ge=0, le=300)
    wait_random_rate: float = Field(ge=0, le=10)
    wait_initial_multiplier: float = Field(ge=0, le=10)
    wait_scroll_multiplier: float = Field(ge=0, le=10)
    wait_post_multiplier: float = Field(ge=0, le=10)
    wait_detail_open_multiplier: float = Field(ge=0, le=10)
    wait_detail_close_multiplier: float = Field(ge=0, le=10)
    wait_error_multiplier: float = Field(ge=0, le=10)


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
    for field in ("action_id", "task_id"):
        if isinstance(result.get(field), ObjectId):
            result[field] = str(result[field])
    return result


async def crawler_status(redis_client, crawler_id: str) -> str:
    state = await redis_client.hget(f"crawler_status:{crawler_id}", "state")
    if state == "idle":
        return "idle"
    if state in {"starting", "running"}:
        return "running"
    return "stopped"


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
    await app.state.db.task.create_index([("enqueued_at", -1)])
    await app.state.db.task.create_index([("crawler_id", 1), ("enqueued_at", -1)])
    await app.state.db.task.create_index([("status", 1), ("enqueued_at", -1)])
    await app.state.db.task.create_index("action_id", unique=True, sparse=True)
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


@app.get("/api/stats")
async def get_stats(request: Request):
    rawdata_count = await request.app.state.db.rawdata.count_documents({})
    return {"rawdata_count": rawdata_count}


@app.get("/api/crawlers")
async def list_crawlers(request: Request):
    crawlers = await request.app.state.db.crawlers.find().sort("crawler_id", 1).to_list(None)
    result = []
    for crawler in crawlers:
        last_log = await request.app.state.db.log.find_one(
            {"crawler_id": crawler["crawler_id"]}, sort=[("timestamp", -1)]
        )
        item = serialize_document(crawler)
        item["status"] = await crawler_status(request.app.state.redis, crawler["crawler_id"])
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


@app.put("/api/crawlers/{crawler_id}")
async def update_crawler(crawler_id: str, payload: CrawlerUpdate, request: Request):
    crawler = await require_crawler(request, crawler_id)
    current_status = await crawler_status(request.app.state.redis, crawler_id)
    if current_status in {"running", "idle"}:
        raise HTTPException(status_code=409, detail="请先停止爬虫再编辑配置")

    updates = payload.model_dump()
    await request.app.state.db.crawlers.update_one({"_id": crawler["_id"]}, {"$set": updates})
    return {**serialize_document(crawler), **updates, "status": current_status}


@app.put("/api/crawlers/{crawler_id}/timing")
async def update_crawler_timing(crawler_id: str, payload: CrawlerTimingUpdate, request: Request):
    crawler = await require_crawler(request, crawler_id)
    updates = payload.model_dump()
    await request.app.state.db.crawlers.update_one({"_id": crawler["_id"]}, {"$set": updates})
    return {**serialize_document(crawler), **updates}


@app.delete("/api/crawlers/{crawler_id}")
async def delete_crawler(crawler_id: str, request: Request):
    crawler = await require_crawler(request, crawler_id)
    current_status = await crawler_status(request.app.state.redis, crawler_id)
    if current_status in {"running", "idle"}:
        raise HTTPException(status_code=409, detail="请先停止爬虫再删除")

    await request.app.state.db.crawlers.delete_one({"_id": crawler["_id"]})
    await request.app.state.db.log.delete_many({"crawler_id": crawler_id})
    await request.app.state.db.action.delete_many({"crawler_id": crawler_id})
    await request.app.state.db.task.delete_many({"crawler_id": crawler_id})
    await request.app.state.redis.lrem("crawler_queue", 0, crawler_id)
    await request.app.state.redis.delete(
        f"Action_Queue_{crawler_id}",
        f"crawler_status:{crawler_id}",
    )
    return {"message": "爬虫已删除"}


@app.post("/api/crawlers/{crawler_id}/launch")
async def launch_crawler(crawler_id: str, request: Request):
    await require_crawler(request, crawler_id)
    current_status = await crawler_status(request.app.state.redis, crawler_id)
    if current_status in {"running", "idle"}:
        raise HTTPException(status_code=409, detail="爬虫已在运行")
    await request.app.state.redis.rpush("crawler_queue", crawler_id)
    return {"message": "启动任务已入队"}


@app.post("/api/crawlers/{crawler_id}/terminate")
async def terminate_crawler(crawler_id: str, request: Request):
    await require_crawler(request, crawler_id)
    current_status = await crawler_status(request.app.state.redis, crawler_id)
    if current_status not in {"running", "idle"}:
        raise HTTPException(status_code=409, detail="爬虫当前未运行")
    await request.app.state.redis.lpush(f"Action_Queue_{crawler_id}", "TERMINATE")
    return {"message": "停止事件已发送"}


async def enqueue_action(
    request: Request,
    crawler_id: str,
    action: str,
    args: dict | None = None,
    priority: bool = False,
):
    await require_crawler(request, crawler_id)
    document = {
        "crawler_id": crawler_id,
        "action": action,
        "timestamp": time.time(),
    }
    if args:
        document["args"] = args
    result = await request.app.state.db.action.insert_one(document)
    push = request.app.state.redis.lpush if priority else request.app.state.redis.rpush
    await push(f"Action_Queue_{crawler_id}", str(result.inserted_id))
    return {"message": "动作已入队", "action_id": str(result.inserted_id)}


@app.post("/api/crawlers/{crawler_id}/actions/surface")
async def surface(crawler_id: str, request: Request):
    await require_crawler(request, crawler_id)
    enqueued_at = time.time()
    task_document = {
        "crawler_id": crawler_id,
        "type": "surface",
        "status": "queued",
        "enqueued_at": enqueued_at,
        "wait_count": 0,
        "wait_seconds": 0,
        "execution_seconds": 0,
        "active_seconds": 0,
        "operation_count": 0,
        "waits": [],
        "operations": [],
        "result": {
            "grabbed_count": 0,
            "inserted_count": 0,
        },
        "error": None,
    }
    task_result = await request.app.state.db.task.insert_one(task_document)
    action_document = {
        "crawler_id": crawler_id,
        "action": "surface",
        "timestamp": enqueued_at,
        "task_id": task_result.inserted_id,
    }
    try:
        action_result = await request.app.state.db.action.insert_one(action_document)
        await request.app.state.db.task.update_one(
            {"_id": task_result.inserted_id},
            {"$set": {"action_id": action_result.inserted_id}},
        )
        await request.app.state.redis.rpush(
            f"Action_Queue_{crawler_id}", str(action_result.inserted_id)
        )
    except Exception as exc:
        await request.app.state.db.task.update_one(
            {"_id": task_result.inserted_id},
            {
                "$set": {
                    "status": "failed",
                    "finished_at": time.time(),
                    "error": str(exc),
                }
            },
        )
        raise HTTPException(status_code=503, detail="浏览任务入队失败") from exc
    return {
        "message": "浏览任务已入队",
        "task_id": str(task_result.inserted_id),
        "action_id": str(action_result.inserted_id),
    }


@app.post("/api/crawlers/{crawler_id}/actions/screenshot")
async def screenshot(crawler_id: str, request: Request):
    return await enqueue_action(request, crawler_id, "screenshot")


@app.post("/api/crawlers/{crawler_id}/actions/screenshot-priority")
async def screenshot_priority(crawler_id: str, request: Request):
    return await enqueue_action(request, crawler_id, "screenshot", priority=True)


@app.post("/api/crawlers/{crawler_id}/actions/scroll")
async def scroll(crawler_id: str, request: Request):
    return await enqueue_action(request, crawler_id, "scroll")


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


@app.get("/api/tasks")
async def list_tasks(
    request: Request,
    crawler_id: str | None = None,
    task_status: Literal["queued", "running", "completed", "failed", "cancelled"] | None = Query(
        default=None, alias="status"
    ),
    limit: int = Query(default=50, ge=1, le=200),
    before: float | None = None,
):
    query = {}
    if crawler_id:
        query["crawler_id"] = crawler_id
    if task_status:
        query["status"] = task_status
    if before is not None:
        query["enqueued_at"] = {"$lt": before}
    projection = {"waits": 0, "operations": 0}
    tasks = await request.app.state.db.task.find(query, projection).sort(
        "enqueued_at", -1
    ).limit(limit + 1).to_list(limit + 1)
    has_more = len(tasks) > limit
    tasks = tasks[:limit]
    return {
        "items": [serialize_document(task) for task in tasks],
        "next_before": tasks[-1]["enqueued_at"] if has_more and tasks else None,
    }


@app.get("/api/tasks/summary")
async def task_summary(
    request: Request,
    crawler_id: str | None = None,
    from_timestamp: float | None = Query(default=None, alias="from"),
    to_timestamp: float | None = Query(default=None, alias="to"),
):
    match = {}
    if crawler_id:
        match["crawler_id"] = crawler_id
    if from_timestamp is not None or to_timestamp is not None:
        match["enqueued_at"] = {}
        if from_timestamp is not None:
            match["enqueued_at"]["$gte"] = from_timestamp
        if to_timestamp is not None:
            match["enqueued_at"]["$lte"] = to_timestamp
    result = await request.app.state.db.task.aggregate([
        {"$match": match},
        {"$group": {
            "_id": None,
            "task_count": {"$sum": 1},
            "completed_count": {"$sum": {"$cond": [{"$eq": ["$status", "completed"]}, 1, 0]}},
            "failed_count": {"$sum": {"$cond": [{"$eq": ["$status", "failed"]}, 1, 0]}},
            "average_queue_seconds": {"$avg": {"$cond": [{"$in": ["$status", ["completed", "failed"]]}, "$queue_seconds", None]}},
            "average_execution_seconds": {"$avg": {"$cond": [{"$in": ["$status", ["completed", "failed"]]}, "$execution_seconds", None]}},
            "average_wait_seconds": {"$avg": {"$cond": [{"$in": ["$status", ["completed", "failed"]]}, "$wait_seconds", None]}},
            "average_active_seconds": {"$avg": {"$cond": [{"$in": ["$status", ["completed", "failed"]]}, "$active_seconds", None]}},
            "total_execution_seconds": {"$sum": {"$cond": [{"$in": ["$status", ["completed", "failed"]]}, {"$ifNull": ["$execution_seconds", 0]}, 0]}},
            "total_wait_seconds": {"$sum": {"$cond": [{"$in": ["$status", ["completed", "failed"]]}, {"$ifNull": ["$wait_seconds", 0]}, 0]}},
        }},
    ]).to_list(1)
    if not result:
        return {
            "task_count": 0,
            "completed_count": 0,
            "failed_count": 0,
            "success_rate": 0,
            "average_queue_seconds": 0,
            "average_execution_seconds": 0,
            "average_wait_seconds": 0,
            "average_active_seconds": 0,
            "wait_ratio": 0,
        }
    summary = result[0]
    summary.pop("_id", None)
    finished_count = summary["completed_count"] + summary["failed_count"]
    summary["success_rate"] = (
        summary["completed_count"] / finished_count if finished_count else 0
    )
    total_execution = summary.pop("total_execution_seconds")
    total_wait = summary.pop("total_wait_seconds")
    summary["wait_ratio"] = total_wait / total_execution if total_execution else 0
    for field, value in summary.items():
        if value is None:
            summary[field] = 0
    return summary


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str, request: Request):
    try:
        object_id = ObjectId(task_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="无效的任务 ID") from exc
    task = await request.app.state.db.task.find_one({"_id": object_id})
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return serialize_document(task)


@app.post("/api/tasks/{task_id}/cancel")
async def cancel_task(task_id: str, request: Request):
    try:
        object_id = ObjectId(task_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="无效的任务 ID") from exc

    cancelled_at = time.time()
    result = await request.app.state.db.task.update_one(
        {
            "_id": object_id,
            "status": {"$in": ["queued", "running"]},
        },
        [
            {
                "$set": {
                    "execution_seconds": {
                        "$cond": [
                            {"$eq": ["$status", "running"]},
                            {"$max": [0, {"$subtract": [cancelled_at, "$started_at"]}]},
                            0,
                        ]
                    },
                    "active_seconds": {
                        "$cond": [
                            {"$eq": ["$status", "running"]},
                            {
                                "$max": [
                                    0,
                                    {
                                        "$subtract": [
                                            {"$subtract": [cancelled_at, "$started_at"]},
                                            {"$ifNull": ["$wait_seconds", 0]},
                                        ]
                                    },
                                ]
                            },
                            0,
                        ]
                    },
                    "total_seconds": {
                        "$max": [0, {"$subtract": [cancelled_at, "$enqueued_at"]}]
                    },
                    "status": "cancelled",
                    "cancelled_at": cancelled_at,
                    "finished_at": cancelled_at,
                }
            }
        ],
    )
    if result.modified_count:
        return {"message": "任务已取消"}

    task = await request.app.state.db.task.find_one(
        {"_id": object_id},
        {"status": 1},
    )
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    raise HTTPException(status_code=409, detail="任务已经结束")


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: str, request: Request):
    try:
        object_id = ObjectId(task_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="无效的任务 ID") from exc

    result = await request.app.state.db.task.delete_one(
        {
            "_id": object_id,
            "status": {"$in": ["completed", "failed", "cancelled"]},
        }
    )
    if result.deleted_count:
        return {"message": "任务已删除"}

    task = await request.app.state.db.task.find_one(
        {"_id": object_id},
        {"status": 1},
    )
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    raise HTTPException(status_code=409, detail="请先结束任务再删除")