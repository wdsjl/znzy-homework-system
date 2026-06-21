$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

function Say($msg, $color = "Cyan") {
  Write-Host $msg -ForegroundColor $color
}

Say "==> [1/6] znzy-homework PM2 install (port 3200)"
Say "    path: $Root"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js not found. Install Node 20+ from https://nodejs.org/"
}

Say ("    node: " + (node -v)) "Gray"
Say ("    npm:  " + (npm -v)) "Gray"

Say "==> [2/6] npm install (may take a few minutes)..."
npm install --no-fund --no-audit
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

Say "==> [3/6] npm run build..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

if (-not (Test-Path (Join-Path $Root "dist\index.html"))) {
  throw "dist/index.html missing after build"
}

Say "==> [4/6] pm2..."
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Say "    installing pm2 globally..."
  npm install -g pm2
  if ($LASTEXITCODE -ne 0) { throw "pm2 install failed" }
}

$ecosystem = Join-Path $PSScriptRoot "ecosystem.config.cjs"
pm2 delete znzy-homework 2>$null | Out-Null
pm2 start $ecosystem --update-env
if ($LASTEXITCODE -ne 0) { throw "pm2 start failed" }

pm2 save
Say "==> [6/6] checking endpoints..."
Start-Sleep -Seconds 3

try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:3200/api/health" -TimeoutSec 15
  Say "    health OK storage=$($health.storage) h5=$($health.serveStatic)" "Green"
  if (-not $health.standaloneTest) {
    Say "    WARN standalone-test.html missing in dist/public" "Yellow"
  }
} catch {
  Say "    health check FAILED" "Red"
  pm2 logs znzy-homework --lines 30 --nostream
  throw $_
}

try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:3200/standalone-test.html" -UseBasicParsing -TimeoutSec 10
  if ($r.StatusCode -eq 200) {
    Say "    standalone-test.html OK" "Green"
  }
} catch {
  Say "    standalone-test.html FAILED - run: npm run build && pm2 restart znzy-homework" "Red"
  throw $_
}

Say ""
Say "DONE. Useful commands:" "Green"
Say "  pm2 status"
Say "  pm2 logs znzy-homework"
Say "  pm2 restart znzy-homework"
Say ""
Say "Browser test:" "Green"
Say "  https://znzy.lhyun.net/standalone-test.html"
Say "  http://127.0.0.1:3200/api/health"
