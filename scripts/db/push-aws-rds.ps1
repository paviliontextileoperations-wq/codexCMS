param(
  [string]$HostName = "pavilion-inventory-db.cbm24y2w4puz.eu-south-2.rds.amazonaws.com",
  [string]$Database = "clothing_inventory",
  [string]$UserName = "postgres",
  [Parameter(Mandatory = $true)]
  [string]$Password,
  [string]$PsqlBin = "C:\Program Files\PostgreSQL\18\bin",
  [switch]$InspectOnly
)

$ErrorActionPreference = "Stop"

function Read-EnvValue([string]$Key) {
  $envPath = Join-Path (Get-Location) ".env"
  if (-not (Test-Path $envPath)) {
    return $null
  }
  foreach ($line in Get-Content $envPath) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }
    $parts = $trimmed.Split("=", 2)
    if ($parts.Length -eq 2 -and $parts[0].Trim() -eq $Key) {
      return $parts[1].Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

$psql = Join-Path $PsqlBin "psql.exe"
$pgDump = Join-Path $PsqlBin "pg_dump.exe"
if (-not (Test-Path $psql)) {
  throw "psql.exe not found at $psql"
}
if (-not (Test-Path $pgDump)) {
  throw "pg_dump.exe not found at $pgDump"
}

$localDatabaseUrl = Read-EnvValue "DATABASE_URL"
if (-not $localDatabaseUrl) {
  throw "DATABASE_URL was not found in .env"
}

Write-Host "Checking network access to ${HostName}:5432 ..."
$tcp = Test-NetConnection -ComputerName $HostName -Port 5432 -InformationLevel Quiet
if (-not $tcp) {
  throw "Cannot reach the RDS endpoint on port 5432. Enable public access or allow this machine's IP in the RDS security group, then retry."
}

$cloudConn = "host=$HostName port=5432 dbname=$Database user=$UserName sslmode=require connect_timeout=15"
$exportDir = Join-Path (Get-Location) "exports\aws-rds"
New-Item -ItemType Directory -Force -Path $exportDir | Out-Null
$dumpPath = Join-Path $exportDir "latest-cms-cloud.sql"
$filteredDumpPath = Join-Path $exportDir "latest-cms-cloud-rds-compatible.sql"

function Invoke-External([scriptblock]$Command, [string]$Label) {
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

try {
  $env:PGPASSWORD = $Password

  Write-Host "Connected target:"
  Invoke-External { & $psql $cloudConn -v ON_ERROR_STOP=1 -Atc "select current_database(), current_user, inet_server_addr(), inet_server_port();" } "Target connection check"

  Write-Host "Current cloud CMS objects:"
  Invoke-External { & $psql $cloudConn -v ON_ERROR_STOP=1 -Atc @"
select coalesce(table_schema || '.' || table_name, 'none')
from information_schema.tables
where table_schema = 'cms'
order by table_name;
"@ } "Target object inspection"

  if ($InspectOnly) {
    Write-Host "InspectOnly enabled. No cloud data was changed."
    return
  }

  Write-Host "Creating local dump from current desktop PostgreSQL cms schema ..."
  Invoke-External { & $pgDump "--dbname=$localDatabaseUrl" "--schema=cms" "--clean" "--if-exists" "--no-owner" "--no-privileges" "--file=$dumpPath" } "Local pg_dump"

  # pg_dump 18 emits transaction_timeout, but AWS RDS PostgreSQL 16 does not support it.
  # Keep the source dump unchanged and restore a filtered, RDS-compatible copy.
  Get-Content $dumpPath | Where-Object { $_ -notmatch '^SET transaction_timeout = ' } | Set-Content -Path $filteredDumpPath -Encoding UTF8

  Write-Host "Replacing cloud cms schema with latest local schema and data ..."
  Invoke-External { & $psql $cloudConn -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS cms CASCADE;" } "Cloud schema drop"
  Invoke-External { & $psql $cloudConn -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS citext;" } "Cloud extension setup"
  Invoke-External { & $psql $cloudConn -v ON_ERROR_STOP=1 -f $filteredDumpPath } "Cloud restore"

  Write-Host "Cloud CMS counts after restore:"
  Invoke-External { & $psql $cloudConn -v ON_ERROR_STOP=1 -Atc @"
select 'products=' || count(*) from cms.products
union all select 'skus=' || count(*) from cms.skus
union all select 'customers=' || count(*) from cms.customers
union all select 'orders=' || count(*) from cms.orders
union all select 'invoices=' || count(*) from cms.invoices
union all select 'warehouses=' || count(*) from cms.warehouses
union all select 'inventory_balances=' || count(*) from cms.sku_inventory_balances
union all select 'image_directories=' || count(*) from cms.image_directories
union all select 'product_image_assets=' || count(*) from cms.product_image_assets;
"@ } "Cloud count check"

  Write-Host "AWS RDS restore completed."
  Write-Host "Dump used: $filteredDumpPath"
} finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
