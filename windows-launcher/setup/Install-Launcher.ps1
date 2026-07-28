#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs TardmartLauncher as a Task Scheduler task that fires immediately at logon.

.DESCRIPTION
    1. Verifies the .exe exists in the expected location.
    2. Registers a Task Scheduler task under the current user that launches the
       exe at logon with zero delay and above-normal priority.
    3. Removes any previously registered task with the same name.

.PARAMETER ExePath
    Full path to TardmartLauncher.exe.
    Default: script's parent directory\TardmartLauncher.exe

.EXAMPLE
    # Run from an Administrator PowerShell prompt:
    .\Install-Launcher.ps1

.EXAMPLE
    .\Install-Launcher.ps1 -ExePath "C:\Apps\Tardmart\TardmartLauncher.exe"
#>
param(
    [string]$ExePath = (Join-Path (Split-Path $PSScriptRoot) "TardmartLauncher.exe")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = "TardmartLauncher"

# ── Validate ──────────────────────────────────────────────────────────────────
if (-not (Test-Path $ExePath)) {
    Write-Error @"
TardmartLauncher.exe not found at: $ExePath

Build the launcher first:
  cd windows-launcher
  dotnet publish -c Release -r win-x64 --self-contained false -o publish
Then run this script again with:
  .\setup\Install-Launcher.ps1 -ExePath "$((Split-Path $ExePath))\publish\TardmartLauncher.exe"
"@
    exit 1
}

$ExeDir = Split-Path $ExePath

# ── Remove any existing task ──────────────────────────────────────────────────
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing task '$TaskName'..."
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# ── Build the task ────────────────────────────────────────────────────────────
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action  = New-ScheduledTaskAction -Execute $ExePath -WorkingDirectory $ExeDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser

$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances     IgnoreNew `
    -ExecutionTimeLimit    ([TimeSpan]::Zero) `
    -Priority              4 `                 # above-normal
    -RestartCount          3 `
    -RestartInterval       (New-TimeSpan -Seconds 30) `
    -StartWhenAvailable    $false `
    -DisallowDemandStart   $false

$principal = New-ScheduledTaskPrincipal `
    -UserId    $currentUser `
    -LogonType Interactive `
    -RunLevel  Limited

Register-ScheduledTask `
    -TaskName   $TaskName `
    -Action     $action `
    -Trigger    $trigger `
    -Settings   $settings `
    -Principal  $principal `
    -Description "Starts Tardmart POS launcher immediately at Windows logon." | Out-Null

Write-Host ""
Write-Host "✓ Task '$TaskName' registered successfully." -ForegroundColor Green
Write-Host "  Exe      : $ExePath"
Write-Host "  User     : $currentUser"
Write-Host "  Trigger  : At logon, 0 s delay, priority 4 (above-normal)"
Write-Host ""
Write-Host "To start now without logging out:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "To remove:"
Write-Host "  .\setup\Uninstall-Launcher.ps1"
