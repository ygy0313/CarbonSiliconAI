# 部署到阿里云 ECS（2 核 2 GiB）

> 你现有的 ECS 完全够用。本服务是零依赖 Node 单进程，空载内存约 40-60 MB，
> 加上 Nginx 与系统开销，2G 内存余量充足。瓶颈只会在「同时在线人数」，不在配置。

## 一、架构

```
微信小程序 / 手机浏览器
        │  HTTPS (443)
        ▼
   Nginx（反向代理 + TLS 终结 + 静态资源）
        │  HTTP (127.0.0.1:8787)
        ▼
   node src/index.js（systemd 守护，崩溃自动拉起）
        │
        └── server/data/*.json（档案数据，记得进备份）
```

小程序要求请求必须是 **HTTPS + 备案域名**，所以 Nginx 不是可选项。

## 二、部署步骤（在 ECS 上执行）

### 1. 装 Node 20

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -   # CentOS/Alibaba Cloud Linux
sudo yum install -y nodejs
# Ubuntu/Debian:
# curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
node -v   # v20.x
```

### 2. 拉代码

```bash
sudo mkdir -p /srv/qijuzhu && sudo chown $USER /srv/qijuzhu
git clone git@github.com:ygy0313/CarbonSiliconAI.git /srv/qijuzhu/app
# 服务器上拉 GitHub 建议用 HTTPS + token，或先配好部署密钥
```

### 3. 配置环境变量

```bash
sudo tee /srv/qijuzhu/app.env > /dev/null <<'EOF'
NODE_ENV=production
PORT=8787
SEED_DEMO=false
# 保险箱口令：至少 6 位，务必另存一份到密码管理器。
# 丢了它，已加密的原文永远解不开 —— 这是设计，不是 bug。
QJZ_PASSPHRASE=换成你自己的口令
# 有 LLM key 就填，没有就保持 none（规则引擎照常跑）
LLM_PROVIDER=none
EOF
sudo chmod 600 /srv/qijuzhu/app.env
```

`SEED_DEMO=false` 很重要：生产不要自动造演示档案。

### 4. systemd 守护

```bash
sudo tee /etc/systemd/system/qijuzhu.service > /dev/null <<'EOF'
[Unit]
Description=QiJuZhu API server
After=network.target

[Service]
Type=simple
User=www
WorkingDirectory=/srv/qijuzhu/app/server
EnvironmentFile=/srv/qijuzhu/app.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=3
# 2G 内存的机器，限制一下防失控
MemoryMax=512M

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now qijuzhu
curl -s http://127.0.0.1:8787/health   # {"status":"ok",...}
```

### 5. Nginx + HTTPS

```bash
sudo yum install -y nginx   # 或 apt install nginx
sudo tee /etc/nginx/conf.d/qijuzhu.conf > /dev/null <<'EOF'
server {
    listen 80;
    server_name qijuzhu.example.com;      # 换成你的备案域名
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name qijuzhu.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    # 请求体上限：一条记录最长 1KB，给足余量即可
    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# 证书：有域名就用 Let's Encrypt（免费，90 天自动续期）
sudo yum install -y certbot python3-certbot-nginx
sudo certbot --nginx -d qijuzhu.example.com
```

### 6. 数据备份（每天凌晨 4 点）

```bash
sudo tee /etc/cron.d/qijuzhu-backup > /dev/null <<'EOF'
0 4 * * * root tar czf /srv/qijuzhu/backup/data-$(date +\%F).tgz -C /srv/qijuzhu/app/server data && find /srv/qijuzhu/backup -mtime +30 -delete
EOF
sudo mkdir -p /srv/qijuzhu/backup
```

数据是几十 KB 的 JSON，tar 即可；以后换 SQLite 再换备份方式。

## 三、小程序端怎么连

`miniprogram/utils/api.js` 默认指向 `http://127.0.0.1:8787`。上线前：

```js
// api.js 第一行
let BASE = 'https://qijuzhu.example.com'
```

并把它加进微信后台「开发设置 → 服务器域名 → request 合法域名」。

## 四、2C2G 的容量预估

| 指标 | 预估 |
|---|---|
| 单次编排耗时 | 20-80 ms（无 LLM）/ 300-800 ms（有 LLM） |
| 单请求内存 | < 5 MB |
| 可支撑并发 | 约 50-100 QPS（无 LLM），对「个人 + 小圈子」是几十倍冗余 |
| 磁盘增长 | 每千条记忆约 1 MB，可忽略 |
| 真正要盯的 | Nginx 日志轮转（logrotate 自带）、node 内存（已设 MemoryMax） |

结论：**这套配置支撑 500 个活跃用户没有压力**。先别考虑扩容，先考虑有没有人用。
