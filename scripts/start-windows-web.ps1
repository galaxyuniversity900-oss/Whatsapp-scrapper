$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw "Node.js 20+ is required. Install the current LTS release and run again." }
$nodeVersion = (& node -p "Number(process.versions.node.split('.')[0])").Trim()
if ([int]$nodeVersion -lt 20) { throw "Node.js 20 or newer is required. Detected major version: $nodeVersion" }

$stateRoot = Join-Path $env:LOCALAPPDATA 'WhatsAppScrapper'
$dataRoot = Join-Path $stateRoot 'data'
New-Item -ItemType Directory -Force -Path $stateRoot, $dataRoot | Out-Null
$passwordFile = Join-Path $stateRoot 'admin-password.txt'
if (-not (Test-Path $passwordFile)) {
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 32
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  $password = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  [System.IO.File]::WriteAllText($passwordFile, $password)
}
$adminPassword = (Get-Content -Raw $passwordFile).Trim()
if ($adminPassword.Length -lt 32) { throw "The saved administrator password file is invalid: $passwordFile" }

$env:NODE_ENV = 'production'
$env:HOST = '127.0.0.1'
$env:PORT = '8787'
$env:WA_DATA_DIR = $stateRoot
$env:WA_ADMIN_USER = 'admin'
$env:WA_ADMIN_PASSWORD = $adminPassword

if (-not (Test-Path (Join-Path $ProjectRoot 'node_modules/whatsapp-web.js'))) {
  Write-Host "Installing production dependencies..." -ForegroundColor Cyan
  npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed with exit code $LASTEXITCODE" }
}

Write-Host ''
Write-Host 'WhatsApp Scrapper Web Workspace' -ForegroundColor Green
Write-Host 'URL:      http://127.0.0.1:8787'
Write-Host 'Username: admin'
Write-Host ("Password: " + $adminPassword) -ForegroundColor Yellow
Write-Host ("Data:     " + $dataRoot)
Write-Host 'This service is local to this Windows computer. Press Ctrl+C here to stop it safely.'
$browserJob = Start-Job -ArgumentList 'http://127.0.0.1:8787' -ScriptBlock {
  param($url)
  for ($i = 0; $i -lt 30; $i++) {
    try {
      $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/healthz' -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { Start-Process $url; return }
    } catch {}
    Start-Sleep -Seconds 1
  }
}
try {
  node src/server.js
} finally {
  if ($browserJob) {
    Stop-Job -Id $browserJob.Id -ErrorAction SilentlyContinue
    Remove-Job -Id $browserJob.Id -Force -ErrorAction SilentlyContinue
  }
}
