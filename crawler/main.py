import asyncio
from bson import ObjectId
from db import DB
import hashlib
import os
import time
import random
import uuid
from camoufox.async_api import AsyncCamoufox
from datetime import datetime
import base64

STATUS_TTL = 90
STARTING_TTL = 300

WAIT_STAGES = {
    "wait_initial_multiplier": "initial",
    "wait_scroll_multiplier": "scroll",
    "wait_post_multiplier": "post",
    "wait_detail_open_multiplier": "detail_open",
    "wait_detail_close_multiplier": "detail_close",
    "wait_error_multiplier": "error_recovery",
}

ACQUIRE_STATUS_SCRIPT = """
if redis.call('EXISTS', KEYS[1]) == 1 then
    return 0
end
redis.call('HSET', KEYS[1],
    'state', ARGV[1],
    'instance_id', ARGV[2],
    'updated_at', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
"""

UPDATE_STATUS_SCRIPT = """
if redis.call('HGET', KEYS[1], 'instance_id') ~= ARGV[1] then
    return 0
end
redis.call('HSET', KEYS[1], 'state', ARGV[2], 'updated_at', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
return 1
"""

REFRESH_STATUS_SCRIPT = """
if redis.call('HGET', KEYS[1], 'instance_id') ~= ARGV[1] then
    return 0
end
redis.call('HSET', KEYS[1], 'updated_at', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return 1
"""

RELEASE_STATUS_SCRIPT = """
if redis.call('HGET', KEYS[1], 'instance_id') == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
"""

BLANK_IMAGE = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\x0bIDAT\x08\xd7c\xfa\xff\xff\xff\x00\x03\x01\x00\x01\x04\x00\x01\x18\x0b\xe8\x91\x00\x00\x00\x00IEND\xaeB`\x82'

IMAGE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/x-icon": ".ico",
    "image/vnd.microsoft.icon": ".ico",
}

class TaskCancelled(Exception):
    pass


class Crawler:
    def __init__(self, cid):
        self.cid=cid
        self.instance_id = str(uuid.uuid4())
        self.status_key = f"crawler_status:{cid}"
        self.current_task_id = None
        self.current_operation_index = None
        self.task_started_monotonic = None
        self.operation_started_monotonic = None

    async def acquire_status(self):
        return bool(await DB.r.eval(
            ACQUIRE_STATUS_SCRIPT,
            1,
            self.status_key,
            "starting",
            self.instance_id,
            time.time(),
            STARTING_TTL,
        ))

    async def set_status(self, state):
        return bool(await DB.r.eval(
            UPDATE_STATUS_SCRIPT,
            1,
            self.status_key,
            self.instance_id,
            state,
            time.time(),
            STATUS_TTL,
        ))

    async def refresh_status_once(self):
        return bool(await DB.r.eval(
            REFRESH_STATUS_SCRIPT,
            1,
            self.status_key,
            self.instance_id,
            time.time(),
            STATUS_TTL,
        ))

    async def release_status(self):
        await DB.r.eval(
            RELEASE_STATUS_SCRIPT,
            1,
            self.status_key,
            self.instance_id,
        )

    async def route_filter(self, page):
        strategy = self.config.get("image_strategy", "none")
        if strategy not in {"ban", "blank", "cache"}:
            return

        cache_dir = os.path.join("image_cache", self.cid)
        if strategy == "cache":
            await asyncio.to_thread(os.makedirs, cache_dir, exist_ok=True)

        async def handle_route(route):
            request = route.request
            if request.resource_type != "image" or request.url.startswith("data:"):
                await route.continue_()
                return

            if strategy == "ban":
                await route.abort()
                return

            if strategy == "blank":
                await route.fulfill(status=200, content_type="image/png", body=BLANK_IMAGE)
                return

            cache_key = hashlib.sha256(request.url.encode()).hexdigest()
            cache_path = next(
                (
                    os.path.join(cache_dir, f"{cache_key}{extension}")
                    for extension in set(IMAGE_EXTENSIONS.values())
                    if os.path.exists(os.path.join(cache_dir, f"{cache_key}{extension}"))
                ),
                None,
            )

            if cache_path:
                image_data = await asyncio.to_thread(self._read_file, cache_path)
                content_type = next(
                    mime_type
                    for mime_type, extension in IMAGE_EXTENSIONS.items()
                    if cache_path.endswith(extension)
                )
                await route.fulfill(
                    status=200,
                    content_type=content_type,
                    body=image_data,
                )
                return

            try:
                response = await route.fetch()
                if response.status == 200:
                    image_data = await response.body()
                    content_type = response.headers.get("content-type", "").split(";", 1)[0]
                    extension = IMAGE_EXTENSIONS.get(content_type)
                    if extension:
                        cache_path = os.path.join(cache_dir, f"{cache_key}{extension}")
                        await asyncio.to_thread(self._write_file, cache_path, image_data)
                await route.fulfill(response=response)
            except Exception as error:
                print(f"[图片请求失败] {request.url}: {error}")
                await route.continue_()

        await page.route("**/*", handle_route)

    @staticmethod
    def _read_file(path):
        with open(path, "rb") as file:
            return file.read()

    @staticmethod
    def _write_file(path, data):
        with open(path, "wb") as file:
            file.write(data)

    async def wait(self, multiplier_key, default_multiplier):
        timing = await DB.crawler_db.find_one(
            {"crawler_id": self.cid},
            {
                "wait_base_seconds": 1,
                "wait_random_rate": 1,
                multiplier_key: 1,
            },
        )
        base_seconds = timing.get("wait_base_seconds", 5)
        random_rate = timing.get("wait_random_rate", 0.6)
        multiplier = timing.get(multiplier_key, default_multiplier)
        delay = base_seconds + base_seconds * random_rate * random.random()
        planned_seconds = delay * multiplier
        started_at = time.time()
        started_monotonic = time.monotonic()
        await asyncio.sleep(planned_seconds)
        actual_seconds = time.monotonic() - started_monotonic
        if self.current_task_id is not None:
            await DB.task_db.update_one(
                {
                    "_id": self.current_task_id,
                    "status": {"$in": ["running", "cancelled"]},
                },
                {
                    "$push": {
                        "waits": {
                            "stage": WAIT_STAGES[multiplier_key],
                            "operation_index": self.current_operation_index,
                            "started_at": started_at,
                            "planned_seconds": planned_seconds,
                            "actual_seconds": actual_seconds,
                        }
                    },
                    "$inc": {"wait_count": 1, "wait_seconds": actual_seconds},
                },
            )
            await self.ensure_task_active()

    async def ensure_task_active(self):
        await self.refresh_status_once()
        if self.current_task_id is None:
            return
        task = await DB.task_db.find_one(
            {"_id": self.current_task_id},
            {"status": 1},
        )
        if task is None or task.get("status") != "running":
            raise TaskCancelled()

    async def start_task(self, action):
        task_id = action.get("task_id")
        if task_id is None:
            return
        if isinstance(task_id, str):
            task_id = ObjectId(task_id)
        started_at = time.time()
        task = await DB.task_db.find_one({"_id": task_id}, {"enqueued_at": 1})
        if task is None:
            raise TaskCancelled()
        result = await DB.task_db.update_one(
            {"_id": task_id, "status": "queued"},
            {
                "$set": {
                    "status": "running",
                    "started_at": started_at,
                    "queue_seconds": max(0, started_at - task["enqueued_at"]),
                }
            },
        )
        if result.modified_count == 0:
            raise TaskCancelled()
        self.current_task_id = task_id
        self.task_started_monotonic = time.monotonic()

    async def finish_task(self, status, error=None):
        if self.current_task_id is None:
            return
        finished_at = time.time()
        execution_seconds = time.monotonic() - self.task_started_monotonic
        task = await DB.task_db.find_one(
            {"_id": self.current_task_id},
            {"enqueued_at": 1, "wait_seconds": 1},
        )
        wait_seconds = task.get("wait_seconds", 0) if task else 0
        updates = {
            "status": status,
            "finished_at": finished_at,
            "execution_seconds": execution_seconds,
            "active_seconds": max(0, execution_seconds - wait_seconds),
            "total_seconds": max(0, finished_at - task["enqueued_at"]) if task else execution_seconds,
            "error": error,
        }
        await DB.task_db.update_one(
            {"_id": self.current_task_id, "status": "running"},
            {"$set": updates},
        )

    async def finish_cancelled_task(self):
        if self.current_task_id is None or self.task_started_monotonic is None:
            return
        execution_seconds = time.monotonic() - self.task_started_monotonic
        task = await DB.task_db.find_one(
            {"_id": self.current_task_id, "status": "cancelled"},
            {"wait_seconds": 1},
        )
        if task is None:
            return
        wait_seconds = task.get("wait_seconds", 0)
        await DB.task_db.update_one(
            {"_id": self.current_task_id, "status": "cancelled"},
            {
                "$set": {
                    "execution_seconds": execution_seconds,
                    "active_seconds": max(0, execution_seconds - wait_seconds),
                }
            },
        )

    async def start_operation(self, post_index):
        if self.current_task_id is None:
            return
        task = await DB.task_db.find_one(
            {"_id": self.current_task_id},
            {"operation_count": 1},
        )
        if task is None:
            raise TaskCancelled()
        operation_index = task.get("operation_count", 0)
        result = await DB.task_db.update_one(
            {"_id": self.current_task_id, "status": "running"},
            {
                "$inc": {"operation_count": 1},
                "$push": {
                    "operations": {
                        "index": operation_index,
                        "post_index": post_index,
                        "post_id": None,
                        "status": "running",
                        "started_at": time.time(),
                        "wait_seconds": 0,
                        "error": None,
                    }
                },
            },
        )
        if result.modified_count == 0:
            raise TaskCancelled()
        self.current_operation_index = operation_index
        self.operation_started_monotonic = time.monotonic()

    async def finish_operation(self, status, post_id=None, error=None):
        if self.current_task_id is None or self.current_operation_index is None:
            return
        finished_at = time.time()
        task = await DB.task_db.find_one(
            {"_id": self.current_task_id},
            {"waits": 1},
        )
        if task is None:
            return
        wait_seconds = sum(
            wait["actual_seconds"]
            for wait in task.get("waits", [])
            if wait.get("operation_index") == self.current_operation_index
        )
        elapsed_seconds = time.monotonic() - self.operation_started_monotonic
        await DB.task_db.update_one(
            {
                "_id": self.current_task_id,
                "status": {"$in": ["running", "cancelled"]},
            },
            {
                "$set": {
                    f"operations.{self.current_operation_index}.post_id": post_id,
                    f"operations.{self.current_operation_index}.status": status,
                    f"operations.{self.current_operation_index}.finished_at": finished_at,
                    f"operations.{self.current_operation_index}.elapsed_seconds": elapsed_seconds,
                    f"operations.{self.current_operation_index}.wait_seconds": wait_seconds,
                    f"operations.{self.current_operation_index}.active_seconds": max(0, elapsed_seconds - wait_seconds),
                    f"operations.{self.current_operation_index}.error": error,
                },
            },
        )
        self.current_operation_index = None
        self.operation_started_monotonic = None

    async def log(self, message , detail="",screenshot_page=None):
        img_str=''
        if screenshot_page:
            path=f"log/{self.cid}/{datetime.now().strftime('%Y/%m/%d/%H-%M-%S')}.jpg"
            await screenshot_page.screenshot(path=path,type="jpeg",quality=40)
            with open(path, "rb") as f:
                b64_bytes = base64.b64encode(f.read())   # bytes
                img_str = b64_bytes.decode("utf-8")      # str
        print(f"[{self.cid}] {message} {':' if detail else ''}{detail}")
        await DB.log_db.insert_one({"crawler_id": self.cid, "message": message, "timestamp": time.time(),'detail':detail,'img_str':img_str})

    async def run(self):
        if not await self.acquire_status():
            await self.log("Error","Repeated")
            return

        try:
            self.config=await DB.crawler_db.find_one({"crawler_id": self.cid})
            if self.config is None:
                await self.log("Error","Inexistent")
                return
            await self.log("Starting")
            self.user_data_dir=self.config['user_data_dir']

            proxy_config = self.config.get("proxy", {})
            proxy = None
            if proxy_config.get("url"):
                proxy = {"server": proxy_config["url"]}
                if proxy_config.get("user"):
                    proxy["username"] = proxy_config["user"]
                if proxy_config.get("password"):
                    proxy["password"] = proxy_config["password"]

            async with AsyncCamoufox(window=(1282, 855), headless="virtual",persistent_context=True,user_data_dir=f"./{self.user_data_dir}",proxy=proxy) as context:
                page = await context.new_page()
                await self.route_filter(page)

                await self.log("Started")
                await self.set_status("idle")
                while True:
                    await self.refresh_status_once()
                    cm = await DB.r.blpop(f"Action_Queue_{self.cid}", timeout=60) # 阻塞等待Action
                    if not cm:
                        await self.refresh_status_once()
                        continue
                    _,action_id = cm
                    if action_id=="TERMINATE":
                        await self.log("Terminated")
                        return

                    action = await DB.action_db.find_one({"_id": ObjectId(action_id)})
                    if not action:
                        await self.log("Error","Action Not Found")
                        continue

                    await self.set_status("running")
                    await self.log(f"Processing",f"action_id[{action_id}]")
                    try:
                        await self.start_task(action)
                        await self.ensure_task_active()
                        await self.work(action, page)
                    except TaskCancelled:
                        await self.finish_cancelled_task()
                        await self.log("Cancelled", f"action_id[{action_id}]")
                        await self.set_status("idle")
                        continue
                    except Exception as e:
                        await self.log("Error",str(e))
                        await self.finish_task("failed", error=str(e))
                    else:
                        await self.finish_task("completed")
                    finally:
                        self.current_task_id = None
                        self.current_operation_index = None
                        self.task_started_monotonic = None
                        self.operation_started_monotonic = None
                    await self.log("Completed", screenshot_page=page)
                    await self.set_status("idle")
        finally:
            await self.release_status()

    async def work(self, action,page):
        return         

class XhsCrawler(Crawler):
    async def grab_info(self, post):
        href = await post.locator('a[href*="/explore/"]').first.get_attribute("href")
        postid = href.split("/explore/", 1)[1].split("?", 1)[0].rstrip("/")

        img = await post.locator("a").nth(1).locator("img").get_attribute("src")
        text = await post.locator(".title").inner_text()
        like = await post.locator(".count").inner_text()

        return {"text": text, "id": postid, "like": like, "img": img}

    async def grab(self,page):
        posts = page.locator("css=.feeds-container").locator("section")
        result = []
        seen_post_ids = set()
        failed_post_ids = set()
        stagnant_rounds = 0
        consecutive_warnings = 0
        max_posts = self.config.get("surface_max_posts", 50)

        await self.wait("wait_initial_multiplier", 1.0)

        while len(result) < max_posts and stagnant_rounds < 3:
            await self.ensure_task_active()
            total = await posts.count()
            candidate_index = None
            for index in range(total):
                href = await posts.nth(index).locator('a[href*="/explore/"]').first.get_attribute("href")
                if not href:
                    continue
                post_id = href.split("/explore/", 1)[1].split("?", 1)[0].rstrip("/")
                if post_id not in seen_post_ids and post_id not in failed_post_ids:
                    candidate_index = index
                    candidate_post_id = post_id
                    break

            if candidate_index is None:
                await page.mouse.wheel(0, random.randint(900, 1400))
                await self.wait("wait_scroll_multiplier", 0.8)
                loaded_post_ids = set(await posts.evaluate_all("""
                    elements => elements
                        .map(element => element.querySelector('a[href*="/explore/"]')?.getAttribute('href'))
                        .filter(Boolean)
                        .map(href => href.split('/explore/', 2)[1].split('?', 1)[0].replace(/\/$/, ''))
                """))
                new_post_ids = loaded_post_ids - seen_post_ids - failed_post_ids
                stagnant_rounds = stagnant_rounds + 1 if not new_post_ids else 0
                continue

            post = posts.nth(candidate_index)
            await self.start_operation(candidate_index)

            try:
                await post.evaluate("""
                    el => el.scrollIntoView({
                        block: 'center',
                        behavior: 'instant'
                    })
                """)
                await post.wait_for(timeout=5000, state="visible")
                await post.locator(".title").wait_for(timeout=10000, state="visible")
            except Exception as e:
                await self.log("Warning", f"Post {candidate_index} Not Ready: {e}")
                failed_post_ids.add(candidate_post_id)
                consecutive_warnings += 1
                await self.finish_operation("failed", error=str(e))
                if consecutive_warnings >= 5:
                    await self.log(
                        "Warning",
                        "Surface failed after 5 consecutive post warnings",
                    )
                    raise RuntimeError("5 consecutive post warnings")
                continue

            await page.mouse.move(
                random.randint(200, 900),
                random.randint(150, 600),
                steps=random.randint(8, 24)
            )
            await self.wait("wait_post_multiplier", 0.4)

            try:
                p = await self.grab_info(post)
                if p["id"] in seen_post_ids:
                    await self.finish_operation("skipped", post_id=p["id"])
                    continue
                seen_post_ids.add(p["id"])

                print(p)

                await post.click(timeout=5000)
                content = page.locator("#detail-desc")
                await content.wait_for(timeout=10000, state="visible")
                await self.wait("wait_detail_open_multiplier", 0.6)
                await page.screenshot(path=f"log/{self.cid}/{datetime.now().strftime('%Y/%m/%d/%H-%M-%S')}.jpg",type="jpeg",quality=50)
                try:
                    title = page.locator("#detail-title")
                    bottom = page.locator(".bottom-container")

                    comments_container = page.locator(".comments-container")
                    try:
                        comments_count = await comments_container.locator(".total").text_content()
                    except:
                        comments_count = "共 0 条评论 "
                    x={"comments_count": comments_count, "content": await content.text_content(), "title": await title.text_content(), "bottom": await bottom.text_content()}
                    p = {**p, **x,"source": "xhs", "timestamp": time.time()}
                except Exception as e:
                    await self.log("Error",f"Grab {candidate_index} Failed: {e}",screenshot_page=page)
                await self.ensure_task_active()
                await DB.rawdata_db.insert_one(p)
                await DB.task_db.update_one(
                    {
                        "_id": self.current_task_id,
                        "status": {"$in": ["running", "cancelled"]},
                    },
                    {
                        "$inc": {
                            "result.grabbed_count": 1,
                            "result.inserted_count": 1,
                        }
                    },
                )
                result.append(p)
                await self.log("Checkpoint",str(p['text']),screenshot_page=page)

                await page.keyboard.press('Escape')
                await content.wait_for(timeout=5000, state="hidden")
                await self.wait("wait_detail_close_multiplier", 0.6)
                await self.finish_operation("completed", post_id=p["id"])
                consecutive_warnings = 0
                
            except TaskCancelled:
                raise
            except Exception as e:
                await self.log('Warning',detail=f'Error: Grab {candidate_index} Failed: {e}',screenshot_page=page)
                failed_post_ids.add(candidate_post_id)
                consecutive_warnings += 1
                await page.keyboard.press('Escape')
                await self.wait("wait_error_multiplier", 0.6)
                await self.finish_operation("failed", error=str(e))
                if consecutive_warnings >= 5:
                    await self.log(
                        "Warning",
                        "Surface failed after 5 consecutive post warnings",
                    )
                    raise RuntimeError("5 consecutive post warnings")
                continue
        return result

    async def surface(self,page):
        res=await self.grab(page)
        if res:
            await self.log("Checkpoint", f"Inserted {len(res)} docs")
        else:
            await self.log("Checkpoint", "No data grabbed")
        return {"grabbed_count": len(res), "inserted_count": len(res)}

    async def work(self, action,page):
        if action['action']=="surface":
            await self.log("Action","Surface")
            return await self.surface(page)
        elif action['action']=="goto":
            await page.goto(action['args']['url'])
        elif action['action']=="scroll":
            await self.log("Action","Scroll")
            posts = page.locator("css=.feeds-container").locator("section")
            target_index = await posts.evaluate_all("""
                elements => {
                    const index = elements.findIndex(
                        element => element.getBoundingClientRect().top > window.innerHeight / 2
                    )
                    return index === -1 ? elements.length - 1 : index
                }
            """)
            if target_index >= 0:
                post = posts.nth(target_index)
                await post.evaluate("""
                    element => element.scrollIntoView({
                        block: 'center',
                        behavior: 'instant'
                    })
                """)
        elif action['action']=="screenshot":
            await self.log("Screenshot", screenshot_page=page)
        else:
            await self.log("Error","Action Undifined")
async def launcher():
    semaphore = asyncio.Semaphore(4)
    crawler_set=set()
    while True:
        await semaphore.acquire()
        res=await DB.r.blpop("crawler_queue", timeout=60)
        if res:
            _,cid=res
            print(f"[+] Launching Crawler {cid}")
            c = XhsCrawler(cid)
            t = asyncio.create_task(c.run())
            crawler_set.add(t) # 防止crawler意外被GC回收
            t.add_done_callback(lambda t: [crawler_set.discard(t), semaphore.release()])
        else:
            semaphore.release()
            # 充当heartbeat,一举两得
            continue

async def main():
    await DB.init()
    await launcher()

if __name__ == "__main__":
    asyncio.run(main())