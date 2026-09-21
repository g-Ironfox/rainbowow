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
STATUS_HEARTBEAT_INTERVAL = 30

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

class Crawler:
    def __init__(self, cid):
        self.cid=cid
        self.instance_id = str(uuid.uuid4())
        self.status_key = f"crawler_status:{cid}"

    async def acquire_status(self):
        return bool(await DB.r.eval(
            ACQUIRE_STATUS_SCRIPT,
            1,
            self.status_key,
            "starting",
            self.instance_id,
            time.time(),
            STATUS_TTL,
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

    async def refresh_status(self):
        while True:
            await asyncio.sleep(STATUS_HEARTBEAT_INTERVAL)
            refreshed = await DB.r.eval(
                REFRESH_STATUS_SCRIPT,
                1,
                self.status_key,
                self.instance_id,
                time.time(),
                STATUS_TTL,
            )
            if not refreshed:
                return

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

        heartbeat_task = asyncio.create_task(self.refresh_status())
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
                    cm = await DB.r.blpop(f"Action_Queue_{self.cid}", timeout=60) # 阻塞等待Action
                    if not cm:
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
                        await self.work(action, page)
                    except Exception as e:
                        await self.log("Error",str(e))
                    await self.log("Completed")
                    await self.set_status("idle")
        finally:
            heartbeat_task.cancel()
            await asyncio.gather(heartbeat_task, return_exceptions=True)
            await self.release_status()

    async def work(self, action,page):
        return         

class XhsCrawler(Crawler):
    async def grab_info(self, post):
        href = await post.locator("a").first.get_attribute("href")
        postid = href.replace("/explore/", "")

        img = await post.locator("a").nth(1).locator("img").get_attribute("src")
        text = await post.locator(".title").inner_text()
        like = await post.locator(".count").inner_text()

        return {"text": text, "id": postid, "like": like, "img": img}

    async def grab(self,page):
        posts = page.locator("css=.feeds-container").locator("section")
        total = await posts.count()
        result = []
        
        await asyncio.sleep(random.randint(3,6))

        for i in range(total):
            post = posts.nth(i)

            await post.evaluate("""
                el => el.scrollIntoView({
                    block: 'center',
                    behavior: 'instant'
                })
            """)

            await page.mouse.move(
                random.randint(200, 900),
                random.randint(150, 600),
                steps=random.randint(5, 20)
            )

            try:
                await post.wait_for(timeout=1000, state="visible")
            except:
                break

            await page.screenshot(path=f"log/{self.cid}/{datetime.now().strftime('%Y/%m/%d/%H-%M-%S')}.jpg",type="jpeg",quality=50)
            await asyncio.sleep(random.random() * 1 + 0.3)

            try:
                p = await self.grab_info(post)

                print(p)

                await post.click()
                await asyncio.sleep(random.random() * 1 + 1.5)
                await page.screenshot(path=f"log/{self.cid}/{datetime.now().strftime('%Y/%m/%d/%H-%M-%S')}.jpg",type="jpeg",quality=50)
                try:
                    content = page.locator("#detail-desc")
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
                    await self.log("Error",f"Grab {i} Failed: {e}",screenshot_page=page)
                result.append(p)
                await self.log("Checkpoint",str(p['text']),screenshot_page=page)

                await page.keyboard.press('Escape')
                await asyncio.sleep(random.random() * 1 + 1)
                
            except Exception as e:
                self.log('Warning',detail=f'Error: Grab {i} Failed: {e}',screenshot_page=page)
                break
        return result

    async def surface(self,page):
        res=await self.grab(page)
        if res:
            await DB.rawdata_db.insert_many(res)
            await self.log("Checkpoint", f"Inserted {len(res)} docs")
        else:
            await self.log("Checkpoint", "No data grabbed")

    async def work(self, action,page):
        if action['action']=="surface":
            await self.log("Action","Surface")
            await self.surface(page)
        elif action['action']=="goto":
            await page.goto(action['args']['url'])
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