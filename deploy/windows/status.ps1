$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "=== znzy-homework status ===" -ForegroundColor Cyan

Write-Host "`n-- pm2 --"
if (Get-Command pm2 -ErrorAction SilentlyContinue) {
  pm2 status
} else {
  Write-Host "pm2 not installed" -ForegroundColor Yellow
}

Write-Host "`n-- port 3200 --"
$conn = Get-NetTCPConnection -LocalPort 3200 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  Write-Host "LISTENING pid=$($conn.OwningProcess)" -ForegroundColor Green
} else {
  Write-Host "NOT listening" -ForegroundColor Red
}

Write-Host "`n-- local health --"
try {
  $h = Invoke-RestMethod "http://127.0.0.1:3200/api/health" -TimeoutSec 5
  Write-Host "OK storage=$($h.storage) queue=$($h.gradingQueue)" -ForegroundColor Green
} catch {
  Write-Host "FAIL $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n-- public health --"
try {
  $h2 = Invoke-RestMethod "https://znzy.lhyun.net/api/health" -TimeoutSec 10
  Write-Host "OK https://znzy.lhyun.net is live" -ForegroundColor Green
} catch {
  Write-Host "WARN nginx/cert/dns may not be ready yet" -ForegroundColor Yellow
}

Write-Host "`n-- recent logs --"
if (Get-Command pm2 -ErrorAction SilentlyContinue) {
  pm2 logs znzy-homework --lines 20 --nostream
}
