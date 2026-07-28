#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Removes the TardmartLauncher scheduled task and optionally deletes user data.
#>
param(
    [switch]$DeleteUserData
)

$TaskName   = "TardmartLauncher"
$DataFolder = Join-Path $env:APPDATA "TardmartLauncher"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask   -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "✓ Task '$TaskName' removed." -ForegroundColor Green
} else {
    Write-Host "Task '$TaskName' not found — nothing to remove."
}

if ($DeleteUserData -and (Test-Path $DataFolder)) {
    Remove-Item $DataFolder -Recurse -Force
    Write-Host "✓ User data deleted: $DataFolder" -ForegroundColor Green
}
