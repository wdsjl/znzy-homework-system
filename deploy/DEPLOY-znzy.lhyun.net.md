# znzy.lhyun.net 生产部署指南

智能作业 H5 生产地址：

| 页面 | URL |
|------|-----|
| 测试入口 | https://znzy.lhyun.net/standalone-test.html |
| 完整 H5 | https://znzy.lhyun.net/?studentId=stu-test-001&studentName=测试学生 |
| API 健康检查 | https://znzy.lhyun.net/api/health |

---

## 一、服务器要求

- Linux + Docker / Docker Compose
- 域名 `znzy.lhyun.net` 已解析到服务器公网 IP
- 开放 **80** 端口（HTTPS 建议再开放 **443**）
- 建议配置 2GB+ 内存（OCR / MySQL）

> **注意**：当前域名根路径若已有其他系统（如监控登录页），需先停用旧站点或改用子路径方案（见文末）。

---

## 二、一键部署（推荐）

在服务器上：

```bash
git clone https://github.com/wdsjl/znzy-homework-system.git
cd znzy-homework-system
git checkout cursor/answer-sheet-grading-5472   # 或合并后的 main

# 可选：复制并编辑生产环境变量
cp deploy/env.znzy.lhyun.net.example deploy/.env

npm run deploy:znzy
# 等价于：docker compose -f docker-compose.prod.yml up -d --build
```

默认监听 **80** 端口。若 80 已被占用：

```bash
WEB_PORT=8080 npm run deploy:znzy
```

再由外层 Nginx 把 `znzy.lhyun.net` 反代到 `127.0.0.1:8080`。

---

## 三、验证

```bash
curl -s https://znzy.lhyun.net/api/health
```

浏览器打开：

1. https://znzy.lhyun.net/standalone-test.html → API 状态绿色
2. https://znzy.lhyun.net/ → 完整 H5
3. 智能作业 → 生成题目 → 拍照批改

---

## 四、HTTPS 证书

### 方式 A：宿主机 Certbot + 反代到 Docker

```bash
sudo certbot certonly --nginx -d znzy.lhyun.net
```

外层 Nginx 配置 SSL 后反代到 `127.0.0.1:80`（或 WEB_PORT）。

### 方式 B：证书挂载进 Docker

1. 将证书放到服务器 `/etc/nginx/ssl/znzy.lhyun.net/`
2. 编辑 `deploy/nginx/znzy.lhyun.net.conf` 取消 HTTPS `server` 段注释
3. `docker-compose.prod.yml` 的 `web` 服务增加卷挂载与 `443:443`
4. 重新 `npm run deploy:znzy`

---

## 五、架构说明

```
浏览器 → Nginx (web:80) → 静态 dist (H5)
                        → /api/* → Node API (api:4000)
                        → MySQL + Redis（异步批改）
```

构建参数（已写入 `.env.production`）：

```
VITE_API_BASE=/api
VITE_PUBLIC_ORIGIN=https://znzy.lhyun.net
```

前后端**同域**，手机浏览器可直接访问、拍照上传。

---

## 六、与现有站点共存（子路径）

若根路径必须保留其他系统，使用 `/homework/` 子路径：

1. 构建：`VITE_BASE_PATH=/homework/ VITE_API_BASE=/homework/api npm run build`
2. 将 `deploy/nginx/znzy.lhyun.net.subpath.conf` 合并进现有 Nginx
3. 静态文件放到 `/var/www/znzy-homework/dist/`
4. API 单独跑在 `4000` 端口

访问：`https://znzy.lhyun.net/homework/standalone-test.html`

---

## 七、常用运维命令

```bash
npm run docker:prod:logs      # 查看 web + api 日志
npm run docker:prod:down      # 停止
docker compose -f docker-compose.prod.yml ps
```

---

## 八、你需要改的配置（可选）

| 变量 | 文件 | 说明 |
|------|------|------|
| `LLM_API_KEY` | `deploy/.env` | 主观题 AI 判分 |
| `USE_FORMAL_SCHEMA=1` | `deploy/.env` | 正式数据库表 |
| MySQL 密码 | `docker-compose.prod.yml` | 生产请改强密码 |
