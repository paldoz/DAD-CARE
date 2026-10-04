$ErrorActionPreference = "Stop"

# Dadwork Ledger project
$ProjectDir = "C:\Users\abdiq\OneDrive\Desktop\dadcare app\dadwork-ledger"

# OneDrive backup location
$BackupRoot = "C:\Users\abdiq\OneDrive\Desktop\dadcare app\OneDrive\dadwork-ledger\backups"

# Docker Desktop
$DockerDesktop = "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"

Set-Location $ProjectDir

Write-Host "=== Dadwork Ledger Weekly Backup ===" -ForegroundColor Cyan
Write-Host "Starting backup..."

# Start Docker Desktop if it is not running
if (-not (Get-Process "Docker Desktop" -ErrorAction SilentlyContinue)) {
    Write-Host "Starting Docker Desktop..."
    Start-Process $DockerDesktop
}

# Wait for Docker engine
$DockerReady = $false

for ($i = 1; $i -le 60; $i++) {
    docker version *> $null

    if ($LASTEXITCODE -eq 0) {
        $DockerReady = $true
        break
    }

    Write-Host "Waiting for Docker... ($i/60)"
    Start-Sleep -Seconds 5
}

if (-not $DockerReady) {
    throw "Docker did not become ready."
}

Write-Host "Docker is ready." -ForegroundColor Green

# Create dated backup folder
$Date = Get-Date -Format "yyyy-MM-dd"
$BackupDir = Join-Path $BackupRoot $Date

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

Write-Host "Backup folder: $BackupDir"

# Supabase CLI
$Npx = "C:\Program Files\nodejs\npx.cmd"

if (-not (Test-Path $Npx)) {
    throw "npx.cmd was not found at $Npx"
}

# Schema
Write-Host "Creating schema backup..."
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $Npx supabase db dump --linked --schema public -f "$BackupDir\schema.sql" 2>&1 | ForEach-Object { "$_" }
$ErrorActionPreference = $prevEAP

if ($LASTEXITCODE -ne 0) {
    throw "Schema backup failed."
}

# Data
Write-Host "Creating data backup..."
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $Npx supabase db dump --linked --data-only --use-copy -f "$BackupDir\data.sql" 2>&1 | ForEach-Object { "$_" }
$ErrorActionPreference = $prevEAP

if ($LASTEXITCODE -ne 0) {
    throw "Data backup failed."
}

# Roles
Write-Host "Creating roles backup..."
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $Npx supabase db dump --linked --role-only -f "$BackupDir\roles.sql" 2>&1 | ForEach-Object { "$_" }
$ErrorActionPreference = $prevEAP

if ($LASTEXITCODE -ne 0) {
    throw "Roles backup failed."
}

# Verify files
$Files = @(
    "$BackupDir\schema.sql",
    "$BackupDir\data.sql",
    "$BackupDir\roles.sql"
)

foreach ($File in $Files) {
    if (-not (Test-Path $File)) {
        throw "Backup file missing: $File"
    }

    if ((Get-Item $File).Length -eq 0) {
        throw "Backup file is empty: $File"
    }
}

Write-Host ""
Write-Host "BACKUP SUCCESSFUL" -ForegroundColor Green
Write-Host ""

Get-Item $Files |
    Select-Object Name, Length, LastWriteTime |
    Format-Table -AutoSize

Write-Host "Backup location:"
Write-Host $BackupDir