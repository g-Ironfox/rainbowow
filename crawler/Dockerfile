FROM python:3.11-slim-bookworm

# 1. 安装系统依赖
RUN apt-get update && apt-get install -y \
    xvfb \
    fonts-noto-cjk \
    libgtk-3-0 \
    libgbm1 \
    libnss3 \
    libxss1 \
    libasound2 \
    libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app


RUN pip install --no-cache-dir -r requirements.txt

RUN pip install -U camoufox[geoip]

# 构建时通过 --build-arg GITHUB_TOKEN=xxx 传入, 不要把令牌写死在镜像里
ARG GITHUB_TOKEN=
ENV GITHUB_TOKEN=$GITHUB_TOKEN

RUN camoufox fetch

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "main.py"]