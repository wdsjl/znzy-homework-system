$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

Write-Host "==> 使用 PM2 后台运行 znzy-homework" -ForegroundColor Cyan

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Write-Host "安装 pm2..."
  npm install -g pm2
}

npm install
npm run build

$ecosystem = Join-Path $PSScriptRoot "ecosystem.config.cjs"
pm2 start $ecosystem --update-env
pm2 save

Write-Host ""
Write-Host "已启动。命令：" -ForegroundColor Green
Write-Host "  pm2 logs znzy-homework"
Write-Host "  pm2 restart znzy-homework"
Write-Host "  pm2 stop znzy-homework"
Write-Host ""
Write-Host "本机验证: curl http://127.0.0.1:3200/api/health"
