#!/bin/sh
# 容器级 Xvfb 虚拟显示 (compose 里 DISPLAY=:99)。
# 注意: Camoufox 的 headless="virtual" 会自建 Xvfb, 不依赖这里。
[ -n "$DISPLAY" ] || exec "$@"

Xvfb "$DISPLAY" -screen 0 1920x1080x24 -nolisten tcp &
exec "$@"
