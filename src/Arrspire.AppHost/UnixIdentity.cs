using System.Runtime.InteropServices;

namespace Arrspire.AppHost;

internal static class UnixIdentity
{
    public static uint UserId => OperatingSystem.IsWindows() ? 1000 : GetUserId();
    public static uint GroupId => OperatingSystem.IsWindows() ? 1000 : GetGroupId();

    [DllImport("libc", EntryPoint = "getuid")]
    private static extern uint GetUserId();

    [DllImport("libc", EntryPoint = "getgid")]
    private static extern uint GetGroupId();
}
