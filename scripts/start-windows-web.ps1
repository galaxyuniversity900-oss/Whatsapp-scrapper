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

if (-not (Test-Path (Join-Path $ProjectRoot 'node_modules'))) {
  Write-Host "Installing production dependencies..." -ForegroundColor Cyan
  npm install --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed with exit code $LASTEXITCODE" }
}

$logOut = Join-Path $stateRoot 'server.log'
$logErr = Join-Path $stateRoot 'server-error.log'
$server = Start-Process -FilePath $nodeCommand.Source -ArgumentList @('src/server.js') -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $logOut -RedirectStandardError $logErr
try {
  $ready = $false
  for ($i = 0; $i -lt 25; $i++) {
    if ($server.HasExited) { break }
    try {
      $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8787/healthz' -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) {
    $details = if (Test-Path $logErr) { Get-Content -Raw $logErr } else { 'No server error log was produced.' }
    throw ("The web service did not become ready. Check " + $logErr + [Environment]::NewLine + $details)
  }
  Write-Host ''
  Write-Host 'WhatsApp Scrapper Web Workspace is running.' -ForegroundColor Green
  Write-Host 'URL:      http://127.0.0.1:8787'
  Write-Host 'Username: admin'
  Write-Host ("Password: " + $adminPassword) -ForegroundColor Yellow
  Write-Host ("Data:     " + $dataRoot)
  Write-Host 'This service is local to this Windows computer. Press Ctrl+C here to stop it.'
  Start-Process 'http://127.0.0.1:8787'
  Wait-Process -Id $server.Id
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
}
