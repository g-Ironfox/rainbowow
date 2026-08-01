import asyncio
from bson import ObjectId
from pymongo import cursor
from db import DB
import time
import random
from camoufox.async_api import AsyncCamoufox
from datetime import datetime
import base64

TIMEOUT=60

class Crawler:
    def __init__(self, cid):
        self.cid=cid
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
        cursor = DB.log_db.find({"crawler_id": self.cid}).sort("timestamp", -1).limit(1)
        last_list = await cursor.to_list(length=1)  # 最多取 1 条
        if last_list:
            last=last_list[0]
            if not(last['timestamp']<time.time()-TIMEOUT or last['message'] in ["Terminated","Created"]):
                await self.log("Error","Repeated")
                return
        
        self.config=await DB.crawler_db.find_one({"crawler_id": self.cid})
        if self.config is None:
            await self.log("Error","Inexistent")
            return
        await self.log("Starting")
        self.user_data_dir=self.config['user_data_dir']

        proxy={
            "server": "socks5h://host.docker.internal:10808",
            "username": "spider",
            "password": "rainbow"
            }

        async with AsyncCamoufox(window=(1282, 855), headless="virtual",persistent_context=True,proxy=proxy,user_data_dir=f"./{self.user_data_dir}") as context:
            page = await context.new_page()

            await self.log("Started")
            while True:
                await self.log("Waiting")
                cm = await DB.r.blpop(f"Action_Queue_{self.cid}", timeout=60) # 阻塞等待Action
                if not cm:
                    # timeout 成为了天然的heartbeat
                    continue
                _,action_id = cm
                if action_id=="TERMINATE":
                    await self.log("Terminated")
                    return

                action = await DB.action_db.find_one({"_id": ObjectId(action_id)})
                if not action:
                    await self.log("Error","Action Not Found")
                    continue

                await self.log(f"Processing",f"action_id[{action_id}]")
                try:
                    await self.work(action, page)
                except Exception as e:
                    await self.log("Error",str(e))
                await self.log("Completed")

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