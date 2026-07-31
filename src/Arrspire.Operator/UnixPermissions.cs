using System.Runtime.InteropServices;

namespace Arrspire.Operator;

internal static class UnixPermissions
{
    private const uint PrivateMask = 0x3f; // 077

    public static IDisposable PrivateCreationScope()
        => OperatingSystem.IsWindows()
            ? NoopScope.Instance
            : new UmaskScope(umask(PrivateMask));

    public static void ProtectDirectory(string path)
    {
        Directory.CreateDirectory(path);
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(
                path,
                UnixFileMode.UserRead
                    | UnixFileMode.UserWrite
                    | UnixFileMode.UserExecute);
        }
    }

    public static void ProtectFile(string path)
    {
        if (File.Exists(path) && !OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(
                path,
                UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
    }

    private sealed class UmaskScope(uint previous) : IDisposable
    {
        private bool disposed;

        public void Dispose()
        {
            if (!disposed)
            {
                _ = umask(previous);
                disposed = true;
            }
        }
    }

    private sealed class NoopScope : IDisposable
    {
        public static readonly NoopScope Instance = new();

        public void Dispose()
        {
        }
    }

    [DllImport("libc")]
    private static extern uint umask(uint mask);
}
