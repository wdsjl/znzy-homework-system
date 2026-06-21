@echo off
chcp 65001 >nul
echo === znzy.lhyun.net Nginx / DNS check ===
echo.

echo [1] DNS znzy.lhyun.net
nslookup znzy.lhyun.net
echo.

echo [2] DNS sa.lhyun.net (compare)
nslookup sa.lhyun.net
echo.

echo [3] local port 3200
powershell -Command "try { (Invoke-RestMethod http://127.0.0.1:3200/api/health).serveStatic } catch { 'NOT RUNNING' }"
echo.

echo [4] search znzy in nginx.conf
findstr /i "znzy.lhyun.net" C:\nginx\conf\nginx.conf
if errorlevel 1 (
  echo NOT FOUND - must add deploy\windows\nginx-znzy.snippet.conf to nginx.conf
) else (
  echo FOUND
)
echo.

echo [5] nginx test
cd /d C:\nginx
nginx -t
echo.
echo If DNS OK and znzy in nginx.conf, run: nginx -s reload
pause
