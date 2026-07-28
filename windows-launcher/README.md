# Tardmart Windows Launcher

A small Windows desktop application that opens `https://app.tardmart.com` in a
chromeless, fullscreen WebView2 window — behaving like a native POS application.

## Why not the Edge PWA?

Edge's installed PWA relies on a background **App Host service** that waits for
the Windows shell to fully initialise before activating.  This adds ~60 seconds
of delay after login.  This launcher bypasses that mechanism entirely: it is a
plain Win32 process that starts immediately, allocates a WebView2 control (which
reuses the already-running Edge WebView2 runtime), and navigates to the URL in
about 3–5 seconds.

## Requirements

| Requirement | Notes |
|-------------|-------|
| Windows 10 / 11 | 64-bit |
| Microsoft Edge (WebView2 Runtime) | Ships with every Windows 10/11 machine that has Edge installed — no separate install |
| .NET 8 Runtime | Download from https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe |
| .NET 8 SDK | Only needed to **build** the launcher; not needed on the POS machine |

## Build

```powershell
# On a developer machine with the .NET 8 SDK installed:
cd windows-launcher

# Framework-dependent build (~200 KB exe, requires .NET 8 on the target machine)
dotnet publish -c Release -r win-x64 --self-contained false -o publish

# — OR —

# Self-contained single-file build (~150 MB exe, no .NET install needed on target)
dotnet publish -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publish-standalone
```

The output folder contains `TardmartLauncher.exe` plus `appsettings.json` (which you
can edit to change the URL or disable kiosk mode).

## Configure

Edit `appsettings.json` before publishing (or copy it next to the .exe after):

```json
{
  "Url":            "https://app.tardmart.com",
  "WindowTitle":    "Tardmart",
  "KioskMode":      true,
  "StartMaximized": true,
  "UserDataFolder": "%APPDATA%\\TardmartLauncher\\UserData"
}
```

| Key | Effect |
|-----|--------|
| `Url` | URL to open on launch |
| `KioskMode` | `true` = no title bar, no border, no context menu, no dev tools |
| `StartMaximized` | `true` = fills the screen on start |
| `UserDataFolder` | Where WebView2 stores cookies / localStorage (login persists across restarts) |

## Install on the POS machine

### Step 1 — Copy the exe

```
C:\Apps\Tardmart\
├── TardmartLauncher.exe
├── appsettings.json
└── icon.ico
```

(Copy the entire `publish\` folder output.)

### Step 2 — Register the Task Scheduler task (runs as current user at logon)

Open **PowerShell as Administrator** and run:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope Process   # allow script to run
cd C:\Apps\Tardmart
.\setup\Install-Launcher.ps1 -ExePath "C:\Apps\Tardmart\TardmartLauncher.exe"
```

This creates a task that:
- Fires at logon with **zero delay**
- Runs at **above-normal priority** (priority 4)
- Restarts automatically if it crashes (up to 3 times, 30-second intervals)

### Step 3 — Test without logging out

```powershell
Start-ScheduledTask -TaskName "TardmartLauncher"
```

## Keyboard shortcuts (running)

| Shortcut | Action |
|----------|--------|
| **F5** | Reload the page |
| **F11** | Toggle fullscreen / windowed |
| **Ctrl+Alt+Q** | Quit the launcher (admin exit) |
| **Ctrl+Alt+D** | Open WebView2 DevTools (debugging) |

## Uninstall

```powershell
# Remove the scheduled task only:
.\setup\Uninstall-Launcher.ps1

# Remove task AND delete stored login session / cookies:
.\setup\Uninstall-Launcher.ps1 -DeleteUserData
```

## Session persistence

Login sessions are stored in `%APPDATA%\TardmartLauncher\UserData` — the same
folder WebView2 uses for cookies and localStorage.  The user stays logged in
after a restart as long as the JWT token stored in `localStorage` (Tardmart's
auth mechanism) has not expired.  Token lifetime is controlled by
`ACCESS_TOKEN_EXPIRE_MINUTES` in the server's `.env` file (default: 480 min).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Could not initialise WebView2" | Install the WebView2 Runtime: https://go.microsoft.com/fwlink/p/?LinkId=2124703 |
| Blank white screen on startup | Check network; the launcher requires the server to be reachable |
| Login required every time | The `UserDataFolder` path changed or was deleted — ensure it is stable |
| Task not starting after login | Open Task Scheduler → verify task status; check Windows Event Viewer → Task Scheduler logs |
