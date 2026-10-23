#!/usr/bin/env bash
# 起居注 · 一键部署到阿里云 ECS
#
#   bash deploy/deploy.sh              # 部署当前 main（本地用）
#   bash deploy/deploy.sh --check      # 只看服务器状态，不动它
#   bash deploy/deploy.sh --ci         # CI 用：跳过本地 git 状态检查
#
# 设计取向：
#   1. 部署的必须是「已提交且已推送」的版本 —— 服务器从 GitHub 拉，不从本机推，
#      保证线上跑的东西在仓库里能查到、能回滚。
#   2. 三重校验才算成功：commit 一致 + 进程是新起的（uptime 小）+ 健康检查通过。
#   3. 任一步失败，自动回滚到部署前的 commit，不把线上留在半死状态。

set -euo pipefail

HOST=${QJZ_HOST:-root@8.136.205.105}
KEY=${QJZ_KEY:-$HOME/.ssh/id_rsa}
PORT=${QJZ_PORT:-8787}
SVC=qijuzhu
APP_DIR=/srv/qijuzhu/app
BRANCH=main

SSH="ssh -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -i $KEY $HOST"
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
bad() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

remote() { $SSH "$*" 2>/dev/null; }

# ── 参数 ──────────────────────────────────────────
MODE=deploy
for a in "$@"; do
  case "$a" in
    --check) MODE=check ;;
    --ci) MODE=ci ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) printf '未知参数：%s\n' "$a"; exit 2 ;;
  esac
done

# ── 只查看 ────────────────────────────────────────
if [ "$MODE" = "check" ]; then
  say "服务器状态"
  echo "分支   : $(remote "cd $APP_DIR && git rev-parse --short HEAD && git log -1 --format=%s")"
  echo "服务   : $(remote "systemctl is-active $SVC")"
  echo "内存   : $(remote "systemctl show $SVC -p MemoryCurrent --value" | awk '{printf "%.1f MB", $1/1048576}')"
  echo "健康   : $(remote "curl -s --noproxy '*' http://127.0.0.1:$PORT/health")"
  exit 0
fi

# ── 1. 本地状态检查 ───────────────────────────────
say "1/5 检查本地"

LOCAL_SHA=$(git rev-parse --short HEAD)

if [ "$MODE" = "ci" ]; then
  # CI 里 checkout 出来的是 detached HEAD，分支/工作区检查都没意义，
  # 代码本身就是触发这次构建的那个 commit。
  ok "CI 模式，部署 $LOCAL_SHA"
else
  if [ -n "$(git status --porcelain)" ]; then
    bad "工作区有未提交改动，先提交再部署（服务器从仓库拉代码，未提交的传不上去）"
    git status --short | head -10
    exit 1
  fi

  BRANCH_NOW=$(git rev-parse --abbrev-ref HEAD)
  if [ "$BRANCH_NOW" != "$BRANCH" ]; then
    bad "当前分支是 $BRANCH_NOW，部署只认 $BRANCH"
    exit 1
  fi

  git fetch origin "$BRANCH" --quiet
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/$BRANCH)" ]; then
    bad "本地领先或落后 origin/$BRANCH，先 push"
    exit 1
  fi
  ok "本地 $LOCAL_SHA 已推送"
fi

# ── 2. 记录回滚点 ─────────────────────────────────
say "2/5 记录回滚点"
PREV_SHA=$(remote "cd $APP_DIR && git rev-parse --short HEAD" || echo "")
if [ -z "$PREV_SHA" ]; then
  bad "服务器上没有代码，先跑 deploy/remote-setup.sh"
  exit 1
fi
ok "当前线上 $PREV_SHA"

if [ "$PREV_SHA" = "$LOCAL_SHA" ]; then
  say "线上已是 $LOCAL_SHA，仅重启确认"
fi

# ── 3. 拉代码 + 重启 ──────────────────────────────
say "3/5 服务器拉代码并重启"
if ! $SSH "cd $APP_DIR && git fetch --depth 1 origin $BRANCH && git reset --hard origin/$BRANCH && systemctl restart $SVC" 2>/dev/null; then
  bad "拉取或重启失败"
  exit 1
fi
RUNNING_SHA=$(remote "cd $APP_DIR && git rev-parse --short HEAD")
[ "$RUNNING_SHA" = "$LOCAL_SHA" ] && ok "线上代码 $RUNNING_SHA" || { bad "commit 不一致：期望 $LOCAL_SHA 实际 $RUNNING_SHA"; exit 1; }

# ── 4. 健康检查 ───────────────────────────────────
say "4/5 健康检查"
HEALTH=""
for i in $(seq 1 25); do
  HEALTH=$(remote "curl -s --noproxy '*' --max-time 2 http://127.0.0.1:$PORT/health" || true)
  case "$HEALTH" in *'"status":"ok"'*) break ;; esac
  sleep 1
done

if [ -z "$HEALTH" ] || ! echo "$HEALTH" | grep -q '"status":"ok"'; then
  bad "健康检查未通过，日志："
  remote "journalctl -u $SVC -n 25 --no-pager"
  say "回滚到 $PREV_SHA"
  $SSH "cd $APP_DIR && git reset --hard $PREV_SHA && systemctl restart $SVC" 2>/dev/null || true
  bad "已回滚到 $PREV_SHA，请检查提交 $LOCAL_SHA"
  exit 1
fi

# uptime 小 = 确认跑的是刚起的进程，不是赖着不走的旧实例
UPTIME=$(echo "$HEALTH" | sed -n 's/.*"uptime":\([0-9]*\).*/\1/p')
if [ -n "$UPTIME" ] && [ "$UPTIME" -gt 120 ]; then
  bad "进程 uptime ${UPTIME}s，可能是旧实例没换掉"
  exit 1
fi
ok "健康检查通过（uptime ${UPTIME:-?}s）"

# ── 5. 实跑一条编排，确认业务链没坏 ───────────────
say "5/5 业务链路抽检"
RESULT=$(remote "curl -s --noproxy '*' --max-time 15 -X POST http://127.0.0.1:$PORT/api/persons/p_owner/orchestrate -H 'Content-Type: application/json' -d '{\"text\":\"今天中午吃什么\"}'")
CARDS=$(echo "$RESULT" | sed -n 's/.*"summary":"\([^"]*\)".*/\1/p' | head -c 80)
if echo "$RESULT" | grep -q '"cards"'; then
  ok "编排正常：$CARDS"
else
  bad "编排接口异常"
  echo "$RESULT" | head -c 300
  exit 1
fi

printf '\n\033[1;32m部署完成 · %s → %s\033[0m\n' "$PREV_SHA" "$LOCAL_SHA"
echo "外部可达性取决于安全组是否放行 $PORT 端口"
