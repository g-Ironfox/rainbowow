# Rainbow Crawler

基于 Camoufox 的小红书爬虫管理系统: Xvfb 虚拟显示下的浏览器爬虫 + Redis 任务队列 + 管理 CLI, 使用 Docker Compose 一键部署。

## 架构

| 服务      | 说明                                       |
| --------- | ------------------------------------------ |
| `crawler` | Camoufox 浏览器爬虫 (headless="virtual" + Xvfb 虚拟显示), 阻塞消费任务队列  |
| `cli`     | 基于 Typer + Rich 的爬虫管理命令行工具     |
| `redis`   | 任务队列 / 心跳 (Redis 7)                  |
| `mongodb` | 数据存储 (MongoDB 8)                       |

## 快速开始

```bash
# 1. 复制环境变量文件并修改密码
cp .env.example .env

# 2. 构建并启动
docker compose up -d --build
```

## CLI 使用

```bash
# 创建爬虫 (user_data_dir 为浏览器用户数据目录, 用于持久化登录态)
docker compose exec cli python cli.py create <crawler_id> <user_data_dir>

# 启动 / 停止
docker compose exec cli python cli.py launch <crawler_id>
docker compose exec cli python cli.py terminate <crawler_id>
```

## 目录结构

```
.
├── crawler/            # 爬虫服务
│   ├── main.py         # 爬虫主逻辑 (Camoufox)
│   ├── getCookie.py    # 扫码登录获取 Cookie
│   └── db.py           # MongoDB / Redis 客户端
├── cli/                # 管理 CLI
├── data/               # MongoDB / Redis 数据 (不提交)
└── docker-compose.yml
```

## 注意事项

- `crawler/xhs_*` 目录是浏览器用户数据, 包含 Cookie 等登录态, 已被 `.gitignore` 排除, 请勿提交。
- MongoDB 密码通过 `.env` 中的 `MONGO_PASS` 配置, 默认 `changeme`。
- 构建 crawler 镜像时如需 GitHub Token (下载浏览器限流), 请通过 `--build-arg GITHUB_TOKEN=xxx` 传入, 不要写死在 Dockerfile 中。
