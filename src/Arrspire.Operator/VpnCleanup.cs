using System.Text.RegularExpressions;

namespace Arrspire.Operator;

internal static partial class VpnCleanup
{
    public static async Task<int> RunAsync(IReadOnlyList<string> args)
    {
        var instance = args.FirstOrDefault();
        if (instance is null || !InstanceRegex().IsMatch(instance))
        {
            throw new InvalidOperationException(
                "Pass the exact ARRSPIRE_INSTANCE_ID; broad deletion is unsupported.");
        }
        var configured = Environment.GetEnvironmentVariable(
            "ARRSPIRE_CONTAINER_ENGINE");
        var runtime = configured is "docker" or "podman"
            ? configured
            : "docker";
        foreach (var service in new[] { "qbittorrent", "prowlarr", "gluetun" })
        {
            var exitCode = await ProcessRunner.InheritAsync(
                runtime,
                ["rm", "--force", $"arrspire-{instance}-{service}"],
                Environment.CurrentDirectory);
            if (exitCode != 0)
            {
                return exitCode;
            }
        }
        return 0;
    }

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")]
    private static partial Regex InstanceRegex();
}
