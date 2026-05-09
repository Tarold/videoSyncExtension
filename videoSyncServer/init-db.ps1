# Initialize PostgreSQL database schema for Video Sync Server (Windows PowerShell)

# Check if .env file exists
if (-not (Test-Path ".env")) {
    Write-Host "Error: .env file not found. Please create it first." -ForegroundColor Red
    exit 1
}

# Load environment variables from .env
$envFile = Get-Content ".env" -Raw
$envVars = @{}
$envFile -split "`n" | Where-Object {$_ -match '^\w+='} | ForEach-Object {
    $key, $value = $_ -split '=', 2
    $envVars[$key.Trim()] = $value.Trim()
}

$dbUser = $envVars["DB_USER"]
$dbName = $envVars["DB_NAME"]
$dbHost = $envVars["DB_HOST"]

# Check if psql is available
$psqlPath = "C:\Program Files\PostgreSQL\14\bin\psql.exe"
if (-not (Test-Path $psqlPath)) {
    Write-Host "Error: psql not found at $psqlPath. Please verify PostgreSQL installation." -ForegroundColor Red
    exit 1
}

Write-Host "Creating database schema..." -ForegroundColor Cyan

# Execute schema
& $psqlPath -U $dbUser -d $dbName -h $dbHost -f "sql\schema.sql" -v ON_ERROR_STOP=1

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Database schema created successfully!" -ForegroundColor Green
} else {
    Write-Host "✗ Error creating database schema." -ForegroundColor Red
    exit 1
}
