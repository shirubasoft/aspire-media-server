using System.Text.RegularExpressions;
using System.Net;
using System.Net.Sockets;

namespace Arrspire.Operator;

internal static partial class Firewall
{
    public static async Task<int> RunAsync(string root)
    {
        var output = Path.GetFullPath(
            Environment.GetEnvironmentVariable("ARRSPIRE_OUTPUT_PATH")
            ?? Path.Combine(root, "aspire-output"));
        var composePath = Path.Combine(output, "docker-compose.yaml");
        var compose = await File.ReadAllTextAsync(composePath);
        var port = PublishedHttpsPort(compose);
        var routes = await ProcessRunner.RequireOutputAsync(
            "ip", ["-4", "route"], root);
        var cidr = Environment.GetEnvironmentVariable("ARRSPIRE_LAN_CIDR")
            ?? LanIpv4Cidr(routes);
        ValidateIpv4Cidr(cidr);
        var exitCode = await ProcessRunner.InheritAsync(
            "pkexec",
            [
                "ufw", "allow", "from", cidr, "to", "any", "port",
                port.ToString(), "proto", "tcp", "comment", "Arrspire HTTPS LAN",
            ],
            root);
        if (exitCode == 0)
        {
            Console.WriteLine($"Allowed Arrspire HTTPS on TCP {port} from {cidr}.");
        }
        return exitCode;
    }

    internal static int PublishedHttpsPort(string compose)
    {
        var match = HttpsPortRegex().Match(compose);
        return match.Success && int.TryParse(match.Groups[1].Value, out var port)
            && port is > 0 and <= 65535
                ? port
                : throw new InvalidOperationException(
                    "Could not find the published Traefik HTTPS port.");
    }

    internal static string LanIpv4Cidr(string routes)
    {
        var interfaceMatch = DefaultInterfaceRegex().Match(routes);
        if (!interfaceMatch.Success)
        {
            throw new InvalidOperationException(
                "Could not determine the default LAN interface.");
        }
        var device = interfaceMatch.Groups[1].Value;
        foreach (var line in routes.Split('\n'))
        {
            var fields = line.Trim().Split(
                ' ', StringSplitOptions.RemoveEmptyEntries);
            var dev = Array.IndexOf(fields, "dev");
            if (fields.Length > 0 && dev >= 0 && dev + 1 < fields.Length
                && fields[dev + 1] == device && CidrRegex().IsMatch(fields[0]))
            {
                ValidateIpv4Cidr(fields[0]);
                return fields[0];
            }
        }
        throw new InvalidOperationException(
            $"Could not determine the LAN subnet for {device}.");
    }

    internal static void ValidateIpv4Cidr(string cidr)
    {
        var parts = cidr.Split('/', 2);
        if (parts.Length != 2
            || !IPAddress.TryParse(parts[0], out var address)
            || address.AddressFamily != AddressFamily.InterNetwork
            || !int.TryParse(parts[1], out var prefix)
            || prefix is < 0 or > 32)
        {
            throw new InvalidOperationException($"Invalid IPv4 CIDR: {cidr}");
        }
    }

    [GeneratedRegex(@"default(?: via \S+)? dev (\S+)", RegexOptions.Multiline)]
    private static partial Regex DefaultInterfaceRegex();

    [GeneratedRegex(@"^(?:\d{1,3}\.){3}\d{1,3}/(?:[0-9]|[12][0-9]|3[0-2])$")]
    private static partial Regex CidrRegex();

    [GeneratedRegex(
        @"^[ \t]*-[ \t]*[\""']?(?:(?:0\.0\.0\.0|127\.0\.0\.1|\[::\]):)?(\d+):443[\""']?[ \t]*$",
        RegexOptions.Multiline)]
    private static partial Regex HttpsPortRegex();
}
