<#
    AI SOC Analyst L1 - demo runner (Windows / PowerShell)

    Fires the sample Wazuh alerts at your webhook and pauses between them so
    each run finishes before the next arrives.

    Usage:
        $env:SOC_TOKEN = "your-webhook-token"
        .\samples\fire-alerts.ps1

        # optional overrides
        $env:SOC_URL   = "http://localhost:5678/webhook/reportlvl12"
        .\samples\fire-alerts.ps1 -Wait 90

    Each alert's agent name gets a random suffix so repeated runs are never
    swallowed by the 15-minute deduplication window.
#>

param(
    [int]$Wait = 75,
    [string]$Url   = $(if ($env:SOC_URL)   { $env:SOC_URL }   else { "http://localhost:5678/webhook/reportlvl12" }),
    [string]$Token = $env:SOC_TOKEN
)

if (-not $Token) {
    Write-Host "SOC_TOKEN is not set." -ForegroundColor Red
    Write-Host ""
    Write-Host "The webhook is authenticated. You need the same token in two places:" -ForegroundColor Yellow
    Write-Host "  1. the Header Auth credential on the webhook node in n8n"
    Write-Host "  2. this environment variable"
    Write-Host ""
    Write-Host "If you have not created one yet, generate a token:" -ForegroundColor Yellow
    Write-Host '    -join (1..64 | % { ''0123456789abcdef''[(Get-Random -Max 16)] })' -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Then in n8n: Credentials -> Add credential -> Header Auth" -ForegroundColor Yellow
    Write-Host "    Name  = X-SOC-Token      (this is the HTTP header name, not a label)"
    Write-Host "    Value = the token you just generated"
    Write-Host "  ...and select it on the webhook node's Authentication field."
    Write-Host ""
    Write-Host "Finally, export it here:" -ForegroundColor Yellow
    Write-Host '    $env:SOC_TOKEN = "your-token"' -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Full walkthrough: SETUP-GUIDE.md section 4a"
    exit 1
}

$src = Join-Path $PSScriptRoot "test-alerts"
$enc = New-Object System.Text.UTF8Encoding $false   # no BOM - n8n rejects a BOM'd body

function Fire {
    param([string]$File, [string]$Label, [string]$Expect)

    $path = Join-Path $src $File
    if (-not (Test-Path $path)) { Write-Host "  missing: $path" -ForegroundColor Red; return }

    # unique agent name per run so deduplication never suppresses the test
    $p = Get-Content $path -Raw | ConvertFrom-Json
    $p.agent.name = "$($p.agent.name)-$(Get-Random -Minimum 100 -Maximum 999)"

    $tmp = Join-Path $env:TEMP "soc-fire.json"
    [System.IO.File]::WriteAllText($tmp, ($p | ConvertTo-Json -Depth 10), $enc)

    Write-Host ""
    Write-Host ">>> $Label" -ForegroundColor Cyan
    Write-Host "    expect: $Expect" -ForegroundColor DarkGray

    $code = curl.exe -s -o NUL -w "%{http_code}" -X POST $Url `
        -H "Content-Type: application/json" `
        -H "X-SOC-Token: $Token" `
        --data "@$tmp"

    switch ($code) {
        "200" { Write-Host "    200 accepted" -ForegroundColor Green }
        "401" { Write-Host "    401 token mismatch - n8n credential vs SOC_TOKEN (SETUP-GUIDE 4a)" -ForegroundColor Red; return }
        "403" { Write-Host "    403 token mismatch - n8n credential vs SOC_TOKEN (SETUP-GUIDE 4a)" -ForegroundColor Red; return }
        "404" { Write-Host "    404 workflow inactive, or wrong webhook path" -ForegroundColor Red; return }
        default { Write-Host "    $code unexpected" -ForegroundColor Yellow }
    }

    Start-Sleep -Seconds $Wait
}

Write-Host "AI SOC Analyst L1 - firing sample alerts at $Url"
Write-Host ("waiting " + $Wait + "s between alerts so each run completes")

Fire "ssh-bruteforce.json"    "LINUX - SSH brute force"          "CRITICAL, auto-block path, T1110"
Fire "malware-detection.json" "LINUX - crypto-miner file"        "NOT brute force - Resource Hijacking, T1496"
Fire "suspicious-login.json"  "WINDOWS - valid-account logon"    "T1078, exercises the Windows branch"

Write-Host ""
Write-Host "Done. Check:" -ForegroundColor Green
Write-Host "  - your notification channel for three reports"
Write-Host "  - n8n Executions - anything under 200ms was deduplicated, not run"
Write-Host "  - the dashboard, if Supabase is wired up"
