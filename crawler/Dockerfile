# 基础镜像 (Python + Xvfb/图形库) 见 Dockerfile.base, 构建一次即可复用。
FROM rainbowow/crawler-base:py311

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN pip install -U camoufox[geoip]

# 构建时通过 --build-arg GITHUB_TOKEN=xxx 传入, 不要把令牌写死在镜像里
ARG GITHUB_TOKEN=
ENV GITHUB_TOKEN=$GITHUB_TOKEN

RUN camoufox fetch

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]