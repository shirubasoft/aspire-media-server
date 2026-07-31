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
        var failures = new List<string>();
        foreach (var service in new[] { "qbittorrent", "prowlarr", "gluetun" })
        {
            var name = $"arrspire-{instance}-{service}";
            var result = await ProcessRunner.CaptureAsync(
                runtime,
                ["rm", "--force", name],
                Environment.CurrentDirectory);
            if (result.ExitCode != 0
                && !IsMissingContainer(result.StandardError + result.StandardOutput))
            {
                failures.Add($"{name}: {result.StandardError.Trim()}");
            }
        }
        if (failures.Count == 0)
        {
            return 0;
        }
        Console.Error.WriteLine(string.Join(Environment.NewLine, failures));
        return 1;
    }

    internal static bool IsMissingContainer(string output)
        => output.Contains("No such container", StringComparison.OrdinalIgnoreCase)
            || output.Contains(
                "no container with name or ID",
                StringComparison.OrdinalIgnoreCase)
            || output.Contains("does not exist", StringComparison.OrdinalIgnoreCase);

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")]
    private static partial Regex InstanceRegex();
}
