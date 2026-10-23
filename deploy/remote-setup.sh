#!/usr/bin/env bash
# 起居注 · ECS 首次初始化（幂等，可重复执行）
# 用法：scp 到服务器后 bash remote-setup.sh
# 约束：不覆盖已存在的 app.env（保险箱口令丢了，已加密的原文永远解不开）

set -euo pipefail

APP_DIR=/srv/qijuzhu/app
ENV_FILE=/srv/qijuzhu/app.env
REPO=https://github.com/ygy0313/CarbonSiliconAI.git
SVC=qijuzhu
PORT=8787

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

say "1/5 目录"
mkdir -p /srv/qijuzhu
chmod 755 /srv/qijuzhu

say "2/5 代码"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git fetch --depth 1 origin main
  git reset --hard origin/main
  echo "已更新到 $(git rev-parse --short HEAD)"
else
  git clone --depth 1 "$REPO" "$APP_DIR"
  cd "$APP_DIR"
  echo "已克隆 $(git rev-parse --short HEAD)"
fi

say "3/5 环境变量"
if [ ! -f "$ENV_FILE" ]; then
  # 口令只在这里生成一次。之后无论怎么部署都不再改动。
  PASS=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | cut -c1-32)
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=$PORT
# 首次启动生成演示档案 p_owner；真实使用时可改 false（不会删除已有数据）
SEED_DEMO=true
# 保险箱口令：原文 AES-256-GCM 的密钥来源。
# 丢了它，已加密的原文永远解不开 —— 这是设计，不是 bug。请立刻另存一份。
QJZ_PASSPHRASE=$PASS
# 未接大模型时走规则引擎，能力照常（识图/转写会提示「未接通」）
LLM_PROVIDER=none
EOF
  chmod 600 "$ENV_FILE"
  echo "★ 新生成保险箱口令（请立即另存）：$PASS"
else
  echo "沿用已有 $ENV_FILE（口令未改动）"
fi

say "4/5 systemd"
NODE_BIN=$(command -v node || echo /usr/bin/node)
cat > /etc/systemd/system/$SVC.service <<EOF
[Unit]
Description=Qijuzhu gateway (起居注)
Documentation=https://github.com/ygy0313/CarbonSiliconAI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR/server
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN src/index.js
Restart=always
RestartSec=3
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SVC

# 2G 内存的机器上还跑着别的业务，给个上限防失控
MemoryMax=512M
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable $SVC >/dev/null 2>&1 || true
systemctl restart $SVC

say "5/5 自检"
ok=0
for i in $(seq 1 20); do
  if curl -s --noproxy '*' --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done

if [ "$ok" = "1" ]; then
  echo "健康检查通过："
  curl -s --noproxy '*' "http://127.0.0.1:$PORT/health"
  echo
else
  echo "健康检查失败，最近日志："
  journalctl -u $SVC -n 30 --no-pager
  exit 1
fi
