# znzy.lhyun.net 访问到别的项目 — 排查说明

## 原因

你的 `nginx.conf` 里原先只有：

- `sa.lhyun.net` → 3000
- `door.lhyun.net` → 3100
- `api.zntb.lhyun.net` → 8001

**没有** `znzy.lhyun.net` 的 `server { }` 时，浏览器访问该域名会命中 **443 端口的默认站点**（往往是第一个 SSL 站点，例如 sa），所以看到的是另一个项目。

这与 Node / PM2 无关，必须先改 Nginx。

---

## 第一步：确认 DNS

```bat
nslookup znzy.lhyun.net
nslookup sa.lhyun.net
```

两者应解析到 **同一公网 IP**（你的这台服务器）。

若 `znzy` 解析到别的 IP，去域名控制台改 A 记录。

---

## 第二步：把 znzy 站点写进 nginx.conf

用记事本打开：`C:\nginx\conf\nginx.conf`

在 `http {` 内部、**最后一个 `server { ... }` 之后**，粘贴仓库文件全文：

`deploy\windows\nginx-znzy.snippet.conf`

核心内容（请确认 `proxy_pass` 是 **3200**）：

```nginx
    server {
        listen 443 ssl;
        server_name znzy.lhyun.net;
        ...
        location / {
            proxy_pass http://127.0.0.1:3200;
            ...
        }
    }
```

保存后执行：

```bat
cd C:\nginx
nginx -t
nginx -s reload
```

`nginx -t` 必须显示 `successful`。

---

## 第三步：确认本机 3200 是智能作业

```powershell
cd C:\apps\znzy-homework-system
pm2 status
Invoke-RestMethod http://127.0.0.1:3200/api/health
```

应看到 `"service": "znzy-question-api"`。

浏览器本机访问（不经过域名）：

http://127.0.0.1:3200/standalone-test.html

这里正常，外网才错 → 100% 是 Nginx/DNS 问题。

---

## 第四步：一键检查脚本

```bat
C:\apps\znzy-homework-system\deploy\windows\check-nginx.bat
```

---

## 仍不对时

1. 看 Nginx 实际加载的配置里有没有 znzy：

```bat
cd C:\nginx
nginx -T 2>nul | findstr /i znzy
```

无输出 = 配置没加进去或加错文件。

2. 确认没有别的配置文件覆盖（`include` 其它 conf）。

3. 证书：若 `znzy.lhyun.net.pem` 不存在，HTTPS 可能异常；可先用 HTTP 测试：

```bat
curl -I http://znzy.lhyun.net
```

应 301 跳到 https。

---

## 正确结果

| 地址 | 应显示 |
|------|--------|
| http://127.0.0.1:3200/ | 智能作业 H5 |
| https://znzy.lhyun.net/ | 同上（不是 sa/door 登录页） |
| https://znzy.lhyun.net/api/health | JSON，`znzy-question-api` |
