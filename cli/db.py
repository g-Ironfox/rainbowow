import redis.asyncio as redis
import os
import motor.motor_asyncio

DBNAME="rainbow"

class DBClient:
    
    async def init(self):
        host = os.getenv("MONGO_HOST", "mongodb")
        port = os.getenv("MONGO_PORT", "27017")
        user = os.getenv("MONGO_USER", "root")
        password = os.getenv("MONGO_PASS", "114515")

        uri = f"mongodb://{user}:{password}@{host}:{port}/admin"

        self.m = motor.motor_asyncio.AsyncIOMotorClient(uri)

        m_state = await self.m.list_database_names()
        if m_state:
            print("[+]Database Available")
        else:
            print("[-]Error:Database Unavaliabe")
            exit()


        self.crawler_db=self.m[DBNAME]["crawler"]
        self.task_db=self.m[DBNAME]["task"]
        self.action_db=self.m[DBNAME]["action"]
        self.rawdata_db=self.m[DBNAME]["rawdata"]
        self.log_db=self.m[DBNAME]["log"]

        pool = redis.ConnectionPool(
            host='redis',
            port=6379,
            db=0,
            decode_responses=True,
            max_connections=1024  # 连接池最大连接数,因为crwaler要阻塞一个,所以一个crawler要吃掉一个,必须高于crawler数量
            )

        # 从连接池获取连接
        self.r = redis.Redis(connection_pool=pool)

DB=DBClient()