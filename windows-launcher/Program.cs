using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace TardmartLauncher;

static class Program
{
    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
    }
}

sealed class MainForm : Form
{
    // ── Config ────────────────────────────────────────────────────────────────
    private static readonly LauncherConfig Config = LoadConfig();

    private static LauncherConfig LoadConfig()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
        if (!File.Exists(path)) return new LauncherConfig();
        try
        {
            var json = File.ReadAllText(path);
            return JsonSerializer.Deserialize<LauncherConfig>(json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? new LauncherConfig();
        }
        catch { return new LauncherConfig(); }
    }

    // ── WebView2 control ──────────────────────────────────────────────────────
    private readonly WebView2 _webView = new();

    public MainForm()
    {
        Text            = Config.WindowTitle;
        Icon            = LoadAppIcon();
        BackColor       = Color.FromArgb(0x0f, 0x17, 0x2a); // brand dark
        WindowState     = Config.StartMaximized ? FormWindowState.Maximized : FormWindowState.Normal;
        FormBorderStyle = Config.KioskMode      ? FormBorderStyle.None       : FormBorderStyle.Sizable;

        // Fill the form with the WebView
        _webView.Dock = DockStyle.Fill;
        Controls.Add(_webView);

        Load += OnLoad;
        KeyPreview = true;
        KeyDown    += OnKeyDown;
    }

    // ── Initialise WebView2 ───────────────────────────────────────────────────
    private async void OnLoad(object? sender, EventArgs e)
    {
        try
        {
            // Resolve the user-data folder (supports %APPDATA% etc.)
            var rawFolder = Config.UserDataFolder;
            var dataFolder = Environment.ExpandEnvironmentVariables(
                string.IsNullOrWhiteSpace(rawFolder) ? @"%APPDATA%\TardmartLauncher\UserData" : rawFolder);
            Directory.CreateDirectory(dataFolder);

            var env = await CoreWebView2Environment.CreateAsync(null, dataFolder);
            await _webView.EnsureCoreWebView2Async(env);

            // ── Hardening ────────────────────────────────────────────────────
            var settings = _webView.CoreWebView2.Settings;
            settings.AreDefaultContextMenusEnabled  = !Config.KioskMode;
            settings.AreDevToolsEnabled             = !Config.KioskMode;
            settings.IsStatusBarEnabled             = false;
            settings.IsZoomControlEnabled           = false;

            // Block new windows from opening (links that target _blank etc.)
            _webView.CoreWebView2.NewWindowRequested += (s, ev) =>
            {
                ev.Handled = true;
                _webView.CoreWebView2.Navigate(ev.Uri); // open in-frame
            };

            _webView.CoreWebView2.Navigate(Config.Url);
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                $"Could not initialise WebView2.\n\n{ex.Message}\n\n" +
                "Ensure Microsoft Edge (WebView2 Runtime) is installed.",
                "Tardmart Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Application.Exit();
        }
    }

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        switch (e.KeyData)
        {
            // F5 — reload
            case Keys.F5:
                _webView.CoreWebView2?.Reload();
                e.Handled = true;
                break;

            // Ctrl+Alt+Q — quit (admin escape hatch in kiosk mode)
            case Keys.Control | Keys.Alt | Keys.Q:
                Application.Exit();
                e.Handled = true;
                break;

            // Ctrl+Alt+D — toggle dev tools (useful during setup)
            case Keys.Control | Keys.Alt | Keys.D:
                _webView.CoreWebView2?.OpenDevToolsWindow();
                e.Handled = true;
                break;

            // F11 — toggle fullscreen
            case Keys.F11:
                WindowState = WindowState == FormWindowState.Maximized
                    ? FormWindowState.Normal
                    : FormWindowState.Maximized;
                e.Handled = true;
                break;
        }
    }

    // ── Icon ──────────────────────────────────────────────────────────────────
    private static Icon? LoadAppIcon()
    {
        var ico = Path.Combine(AppContext.BaseDirectory, "icon.ico");
        return File.Exists(ico) ? new Icon(ico) : null;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _webView.Dispose();
        base.Dispose(disposing);
    }
}

// ── Config model ──────────────────────────────────────────────────────────────
sealed class LauncherConfig
{
    public string Url            { get; set; } = "https://app.tardmart.com";
    public string WindowTitle    { get; set; } = "Tardmart";
    public bool   KioskMode      { get; set; } = true;
    public bool   StartMaximized { get; set; } = true;
    public string UserDataFolder { get; set; } = @"%APPDATA%\TardmartLauncher\UserData";
}
