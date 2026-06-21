$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

Write-Host "==> znzy.lhyun.net Windows 部署 (Node :3200)" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "未找到 Node.js，请先安装 Node 20+：https://nodejs.org/"
}

Write-Host "==> npm install"
npm install

Write-Host "==> npm run build"
npm run build

$envFile = Join-Path $PSScriptRoot ".env.production"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    $pair = $_ -split '=', 2
    if ($pair.Length -eq 2) {
      $name = $pair[0].Trim()
      $value = $pair[1].Trim()
      [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
  }
}

Write-Host "==> 启动服务 http://127.0.0.1:3200"
Write-Host "    测试: http://127.0.0.1:3200/api/health"
Write-Host "    外网: https://znzy.lhyun.net/standalone-test.html (需 Nginx 已配置)" -ForegroundColor Yellow

node server/index.cjs
