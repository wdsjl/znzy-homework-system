$ErrorActionPreference = "Continue"

Write-Host "==> 本机服务检查 (3200)" -ForegroundColor Cyan
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:3200/api/health" -TimeoutSec 5
  Write-Host "OK: storage=$($health.storage) queue=$($health.gradingQueue)" -ForegroundColor Green
  $health | ConvertTo-Json -Depth 4
} catch {
  Write-Host "FAIL: 3200 端口无响应，请先运行 start.ps1 或 install-pm2.ps1" -ForegroundColor Red
}

Write-Host ""
Write-Host "==> 外网 HTTPS 检查" -ForegroundColor Cyan
try {
  $remote = Invoke-RestMethod -Uri "https://znzy.lhyun.net/api/health" -TimeoutSec 10
  Write-Host "OK: https://znzy.lhyun.net 已上线" -ForegroundColor Green
  $remote | ConvertTo-Json -Depth 4
} catch {
  Write-Host "WARN: 外网暂不可达（检查 DNS / 证书 / Nginx reload）" -ForegroundColor Yellow
}
