#!/bin/bash
# 環境変数ロード
set -a
source ~/.secrets/env/chatwork.env 2>/dev/null || true
source ~/.secrets/env/anthropic.env 2>/dev/null || true
set +a

while true; do
  JST=$(TZ=Asia/Tokyo date +"%H:%M")
  if [ "$JST" = "09:00" ]; then
    cd ~/dev/ga-chatwork-reporter && deno task comment
    sleep 60
  fi
  sleep 30
done
