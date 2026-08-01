import os
import time

import redis
import typer
from pymongo import MongoClient
from rich.console import Console  # 引入 Rich 以获得更好的输出

TIMEOUT=60

# --- 数据库和 Redis 连接设置 (保持不变) ---
MONGO_USER = os.getenv("MONGO_USER", "root")
MONGO_PASS = os.getenv("MONGO_PASS", "114515")
uri = f"mongodb://{MONGO_USER}:{MONGO_PASS}@mongodb:27017/"
# 增加连接超时和服务器选择超时，让连接更健壮
client = MongoClient(uri, serverSelectionTimeoutMS=5000)
db = client["rainbow"]
crawlers_db = db["crawlers"]
log_db = db["log"]
action_db = db["action"]
# ... redis setup ...
r=redis.Redis(host="redis", port=6379, db=0)
# ---------------------------------------------

# 创建 Typer 应用和 Rich Console 实例
app = typer.Typer(
    help="一个用于管理爬虫的 CLI 工具。",
    add_completion=False # 可以暂时关闭补全功能，简化调试
)
console = Console(color_system="truecolor", force_terminal=True)

@app.command("create")
def create_crawler(crawler_id: str,user_data_dir: str , image_strategy: str = "None"):
    crawlers_db.insert_one({"crawler_id": crawler_id, "user_data_dir": user_data_dir,"image_strategy": image_strategy})
    log_db.insert_one({"crawler_id": crawler_id, "message": "Created", "timestamp": time.time()})
    console.print(f"[green]爬虫 '{crawler_id}'创建成功[/green]")

@app.command("launch")
def launch_crawler(crawler_id: str):
    if crawlers_db.find_one({"crawler_id": crawler_id}):
        last=log_db.find({"crawler_id": crawler_id}).sort("timestamp",-1).limit(1)
        if not last or (last[0]['timestamp']<time.time()-TIMEOUT or last[0]['message'] in ["Terminated","Created"]):
            r.rpush("crawler_queue", crawler_id)
            console.print(f"[green]已将爬虫 '{crawler_id}' 添加到队列中[/green]")
        else:
            console.print(f"[yellow]警告: 爬虫 '{crawler_id}' 似乎已经在运行中。[/yellow]")
    else:
        console.print(f"[red]爬虫 '{crawler_id}' 不存在[/red]")

@app.command("terminate")
def stop_crawler(crawler_id: str):
    if crawlers_db.find_one({"crawler_id": crawler_id}):
        last=log_db.find({"crawler_id": crawler_id}).sort("timestamp",-1).limit(1)
        if not(last) or (last[0]['timestamp']<time.time()-TIMEOUT or last[0]['message'] in ["Terminated","Created"]):
            console.print(f"[yellow]警告: 爬虫 '{crawler_id}' 似乎已经停止或异常。[/yellow]")
        else:
            r.lpush(f"Action_Queue_{crawler_id}", "TERMINATE")
            console.print(f"[green]已发布爬虫 '{crawler_id}'停止事件[/green]")
            last=log_db.find({"crawler_id": crawler_id}).sort("timestamp",-1).limit(1)
            if last and last[0]["message"] == "Terminated":
                console.print(f"[green]爬虫 '{crawler_id}' 已成功停止[/green]")
    else:
        console.print(f"[red]爬虫 '{crawler_id}' 不存在[/red]")

@app.command("log")
def crawler_log(crawler_id:str = "",limit:int = 10,only_error:bool = False):
    if not crawler_id:
        filter_query = {}
    else:
        filter_query = {"crawler_id": crawler_id}

    if only_error:
            filter_query["message"] = "Error"
    res=log_db.find(filter_query).sort("timestamp",-1).limit(limit)
    console.print(f"[bold blue]显示最近的日志记录：[/bold blue]")
    for log_entry in list(res)[::-1]:
        console.print(log_entry)        

@app.command("crawlers")
def list_crawlers():
    """
    列出并打印数据库中的所有爬虫配置。
    """
    try:
        crawlers_list = list(crawlers_db.find())

        if not crawlers_list:
            console.print("[yellow]数据库中没有找到任何爬虫配置。[/yellow]")
            return

        console.print(f"[bold green]✅ 成功找到 {len(crawlers_list)} 个爬虫配置：[/bold green]")
        
        # 使用 rich.console 来打印，它会自动美化字典/JSON
        for crawler_doc in crawlers_list:
            console.print(crawler_doc)

    except Exception as e:
        console.print(f"[bold red]❌ 操作失败：无法连接到数据库或查询时出错。[/bold red]")
        console.print("错误详情:", e)
        # 抛出 Typer.Exit 会以非零状态码退出，符合 CLI 规范
        raise typer.Exit(code=1)

@app.command('status')
def status():
    crawlers=crawlers_db.find()
    for i in crawlers:
        last=log_db.find({"crawler_id":i['crawler_id']}).sort("timestamp",-1).limit(1)
        
        if not(last) or (last[0]['timestamp']<time.time()-TIMEOUT or last[0]['message'] in ["Terminated","Created"]):
            s="[red]停止[/red]"
        elif last[0]['timestamp']<time.time()-TIMEOUT:
            s="[red]状态异常[/red]"
        else:
            s="[green]运行中[/green]"
            if last[0]['message'] in ["Idle","Waiting"]:
                s="[magenta]空闲[/magenta]"

        console.print(f"[blue]爬虫ID: {i['crawler_id']}[/blue] 状态:{s}")
        console.print(f"  [yellow]context目录: {i['user_data_dir']}[/yellow]")
        console.print(f"  [yellow]图片策略: {i.get('image_strategy', 'None')}[/yellow]")
        
@app.command("act_surface")
def act_surface(crawler_id: str):
    if crawlers_db.find_one({"crawler_id": crawler_id}):
        res=action_db.insert_one({"crawler_id": crawler_id, "action": "surface", "timestamp": time.time()})
        r.rpush(f"Action_Queue_{crawler_id}", str(res.inserted_id))
        console.print(f"[green]已发布爬虫 '{crawler_id}' surface事件{str(res.inserted_id)[-6:]}[/green]")
    else:
        console.print(f"[red]爬虫 '{crawler_id}' 不存在[/red]")

@app.command("act_goto")
def act_goto(crawler_id: str,url: str):
    if crawlers_db.find_one({"crawler_id": crawler_id}):
        res=action_db.insert_one({"crawler_id": crawler_id, "action": "goto", "args": {"url": url}, "timestamp": time.time()})
        r.rpush(f"Action_Queue_{crawler_id}", str(res.inserted_id))
        console.print(f"[green]已发布爬虫 '{crawler_id}' goto事件{str(res.inserted_id)[-6:]}[/green]")
    else:
        console.print(f"[red]爬虫 '{crawler_id}' 不存在[/red]")

if __name__ == "__main__":
    app()