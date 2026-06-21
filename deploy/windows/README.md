# znzy.lhyun.net · Windows Nginx 部署（与 sa / door 同架构）

你的服务器已是 **Windows Nginx + 本地端口反代** 模式。智能作业按同样方式部署：

```
浏览器 → Nginx (443) → 127.0.0.1:3200 → Node (H5 + API 一体)
```

---

## 第一步：DNS

确保 `znzy.lhyun.net` 已解析到本机公网 IP（与 sa.lhyun.net 相同服务器即可）。

---

## 第二步：SSL 证书

将证书放到（与其他站点一致）：

```
C:/nginx/cert/znzy.lhyun.net.pem
C:/nginx/cert/znzy.lhyun.net.key
```

可用与 door/sa 相同的证书签发方式（阿里云 / 腾讯云 / win-acme 等）。

---

## 第三步：修改 Nginx

打开 `C:/nginx/conf/nginx.conf`，在最后一个 `server { ... }` **之后**、`http` 的 `}` **之前**，粘贴：

**文件位置：** `deploy/windows/nginx-znzy.snippet.conf`

粘贴后执行：

```bat
cd C:\nginx
nginx -t
nginx -s reload
```

---

## 第四步：部署 Node 服务

在服务器上（建议目录 `C:\apps\znzy-homework-system`）：

```powershell
git clone https://github.com/wdsjl/znzy-homework-system.git C:\apps\znzy-homework-system
cd C:\apps\znzy-homework-system
git checkout cursor/answer-sheet-grading-5472
```

### 方式 A：前台测试（先跑通）

```powershell
.\deploy\windows\start.ps1
```

保持窗口不关，浏览器访问 https://znzy.lhyun.net/standalone-test.html

### 方式 B：PM2 后台常驻（推荐）

```powershell
.\deploy\windows\install-pm2.ps1
```

---

## 第五步：验证

```powershell
.\deploy\windows\verify.ps1
```

或浏览器打开：

| 页面 | 地址 |
|------|------|
| 测试入口 | https://znzy.lhyun.net/standalone-test.html |
| 完整 H5 | https://znzy.lhyun.net/?studentId=stu-test-001&studentName=测试学生 |
| API | https://znzy.lhyun.net/api/health |

---

## 端口说明

| 域名 | 本地端口 | 用途 |
|------|----------|------|
| sa.lhyun.net | 3000 | 已有 |
| door.lhyun.net | 3100 | 已有 |
| api.zntb.lhyun.net | 8001 | 已有 |
| **znzy.lhyun.net** | **3200** | 智能作业 H5 |

---

## 可选：Docker 方式（若已装 Docker Desktop）

```powershell
$env:WEB_PORT="3200"
docker compose -f docker-compose.prod.yml up -d --build
```

Nginx 仍反代到 `127.0.0.1:3200`，配置不变。

---

## 常见问题

**1. 502 Bad Gateway**  
→ Node 未启动或 3200 端口未监听。运行 `install-pm2.ps1` 后 `pm2 logs znzy-homework`

**2. 证书错误**  
→ 检查 `C:/nginx/cert/znzy.lhyun.net.pem` 路径与文件名

**3. 拍照上传失败**  
→ Nginx 已设 `client_max_body_size 25m`；确认 Node 进程在运行

**4. 想换端口**  
→ 改 `deploy/windows/.env.production` 的 `API_PORT` 和 nginx 中 `proxy_pass` 端口
