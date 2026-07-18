param(
  [string]$EnvFile = ".env",
  [switch]$SkipLogin
)

$ErrorActionPreference = "Stop"

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [scriptblock]$Command
  )

  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE"
  }
}

function Import-EnvFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Env file not found: $Path"
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) {
      return
    }

    $parts = $line.Split("=", 2)
    if ($parts.Length -ne 2) {
      return
    }

    $name = $parts[0].Trim()
    $value = $parts[1].Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

Import-EnvFile -Path $EnvFile

if (-not $env:SUPABASE_PROJECT_REF) {
  throw "Missing SUPABASE_PROJECT_REF in $EnvFile"
}

if (-not $env:SUPABASE_ACCESS_TOKEN -and -not $SkipLogin) {
  throw "Missing SUPABASE_ACCESS_TOKEN in $EnvFile. Create one at https://supabase.com/dashboard/account/tokens"
}

if (-not $env:SUPABASE_URL -or -not $env:SYNC_SHARED_SECRET) {
  throw "Missing SUPABASE_URL or SYNC_SHARED_SECRET in $EnvFile"
}

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

if (-not $SkipLogin) {
  Invoke-Step { npx supabase login --token $env:SUPABASE_ACCESS_TOKEN }
}

$functionSecretsFile = New-TemporaryFile
try {
  $functionSecrets = Get-Content -LiteralPath $EnvFile | Where-Object {
    $line = $_.Trim()
    -not (
      $line.StartsWith("SUPABASE_ACCESS_TOKEN=") -or
      $line.StartsWith("SUPABASE_PROJECT_REF=") -or
      $line.StartsWith("SUPABASE_SERVICE_ROLE_KEY=") -or
      $line.StartsWith("SYNC_FUNCTION_URL=")
    )
  }
  $functionSecrets += "SERVICE_ROLE_KEY=$env:SUPABASE_SERVICE_ROLE_KEY"
  [System.IO.File]::WriteAllLines($functionSecretsFile, $functionSecrets, $utf8NoBom)

  Invoke-Step { npx supabase link --project-ref $env:SUPABASE_PROJECT_REF }
  Invoke-Step { npx supabase secrets set --env-file $functionSecretsFile }
}
finally {
  Remove-Item -LiteralPath $functionSecretsFile -Force -ErrorAction SilentlyContinue
}

$projectUrlSql = "with existing as (select id from vault.decrypted_secrets where name = 'health_project_url'), updated as (select vault.update_secret(id, '$env:SUPABASE_URL', 'health_project_url') from existing), inserted as (select vault.create_secret('$env:SUPABASE_URL', 'health_project_url') where not exists (select 1 from existing)) select 1;"

$syncSecretSql = "with existing as (select id from vault.decrypted_secrets where name = 'health_sync_shared_secret'), updated as (select vault.update_secret(id, '$env:SYNC_SHARED_SECRET', 'health_sync_shared_secret') from existing), inserted as (select vault.create_secret('$env:SYNC_SHARED_SECRET', 'health_sync_shared_secret') where not exists (select 1 from existing)) select 1;"

Invoke-Step { npx supabase db push --yes }
Invoke-Step { npx supabase db query --linked $projectUrlSql }
Invoke-Step { npx supabase db query --linked $syncSecretSql }
Invoke-Step { npx supabase functions deploy oauth-callback --use-api }
Invoke-Step { npx supabase functions deploy sync-health-data --use-api }

Write-Host "Deployment complete."
