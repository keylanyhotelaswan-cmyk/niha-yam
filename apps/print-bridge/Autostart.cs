using Microsoft.Win32;

namespace Niha.PrintBridge;

/// <summary>HKCU Run key — start Bridge with Windows login.</summary>
public static class Autostart
{
    private const string ValueName = "NihaPrintBridge";

    public static bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Run", false);
        return key?.GetValue(ValueName) is not null;
    }

    public static void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.OpenSubKey(
            @"Software\Microsoft\Windows\CurrentVersion\Run", true);
        if (key is null) return;
        if (enabled)
            key.SetValue(ValueName, $"\"{Application.ExecutablePath}\"");
        else
            key.DeleteValue(ValueName, false);
    }

    /// <summary>Default ON for POS PCs — sync registry to config on every start.</summary>
    public static void ApplyFromConfig(BridgeConfig cfg)
    {
        if (!cfg.StartWithWindowsInitialized)
        {
            cfg.StartWithWindows = true;
            cfg.StartWithWindowsInitialized = true;
            ConfigStore.Save(cfg);
        }

        SetEnabled(cfg.StartWithWindows);
    }
}
