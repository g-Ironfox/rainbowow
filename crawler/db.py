import redis.asyncio as redis
import os
import motor.motor_asyncio

class DBClient:
    
    async def init(self):
        host = os.getenv("MONGO_HOST", "mongodb")
        port = os.getenv("MONGO_PORT", "27017")
        user = os.getenv("MONGO_USER", "root")
        password = os.getenv("MONGO_PASS", "114515")
        db_name = os.getenv("MONGO_DB", "rainbow1")

        uri = f"mongodb://{user}:{password}@{host}:{port}/admin"

        self.m = motor.motor_asyncio.AsyncIOMotorClient(uri)

        m_state = await self.m.list_database_names()
        if m_state:
            print("[+]Database Available")
        else:
            print("[-]Error:Database Unavaliabe")
            exit()

        db = self.m[db_name]
        self.crawler_db=db["crawlers"]
        self.task_db=db["task"]
        self.action_db=db["action"]
        self.rawdata_db=db["rawdata"]
        self.image_cache_db=db["image_cache"]
        self.log_db=db["log"]
        await self.image_cache_db.create_index("url", unique=True)

        pool = redis.ConnectionPool(
            host=os.getenv("REDIS_HOST", "redis"),
            port=int(os.getenv("REDIS_PORT", "6379")),
            db=0,
            decode_responses=True,
            socket_timeout=180,
            max_connections=1024  # 连接池最大连接数,因为crwaler要阻塞一个,所以一个crawler要吃掉一个,必须高于crawler数量
            )

        # 从连接池获取连接
        self.r = redis.Redis(connection_pool=pool)

DB=DBClient()