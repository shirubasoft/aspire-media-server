using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Arrspire.AppHost;
using Arrspire.ControlPlane;

namespace Arrspire.Operator;

internal static class Doctor
{
    private sealed record Check(string Name, bool Passed, string Detail);

    public static async Task<int> RunAsync(string root)
    {
        var checks = new List<Check>();
        await CheckCommandAsync(checks, root, "Aspire CLI", "aspire", ["--version"]);
        var runtime = await DetectRuntimeAsync(root);
        checks.Add(runtime is null
            ? new("Container runtime", false, "Docker/Podman with Compose is unavailable")
            : new("Container runtime", true, $"{runtime} and Compose are available"));

        ArrspirePaths? paths = null;
        try
        {
            paths = ArrspirePaths.Resolve(Path.Combine(root, "Arrspire.AppHost"));
            ArrspirePaths.ValidateLayout(new Dictionary<string, string>
            {
                ["data"] = Path.GetFullPath(paths.Data),
                ["media"] = Path.GetFullPath(paths.Media),
                ["downloads"] = Path.GetFullPath(paths.Downloads),
            });
            foreach (var (name, path) in new[]
            {
                ("Data path", paths.Data),
                ("Media path", paths.Media),
                ("Downloads path", paths.Downloads),
            })
            {
                checks.Add(new(
                    name,
                    Directory.Exists(path),
                    Directory.Exists(path) ? Path.GetFullPath(path) : $"{path} does not exist"));
            }
        }
        catch (Exception exception)
        {
            checks.Add(new("Path layout", false, exception.Message));
        }

        var parameters = await AspireParametersAsync(root);
        try
        {
            Validation.ValidateConfiguration(BuildValidationEnvironment(parameters));
            checks.Add(new("Aspire parameters", true, "configuration is valid"));
        }
        catch (Exception exception)
        {
            checks.Add(new("Aspire parameters", false, exception.Message));
        }

        var domain = Parameter(parameters, "traefik-domain", Ingress.DefaultTraefikDomain);
        var mode = Parameter(parameters, "traefik-tls-mode", "local");
        if (mode == "local" && paths is not null)
        {
            checks.Add(new(
                "Local TLS",
                File.Exists(Path.Combine(
                    paths.Data, "traefik", "dynamic", "certs", "arrspire-local.crt")),
                "run `dotnet run --project Arrspire.Operator -- tls-local` if missing"));
        }
        foreach (var host in new[] { domain, $"auth.{domain}", $"jellyfin.{domain}" })
        {
            try
            {
                var addresses = await Dns.GetHostAddressesAsync(host);
                checks.Add(new($"DNS {host}", addresses.Length > 0, string.Join(", ", addresses.Select(a => a.ToString()))));
            }
            catch (Exception exception)
            {
                checks.Add(new($"DNS {host}", false, exception.Message));
            }
        }

        foreach (var check in checks)
        {
            Console.WriteLine($"{(check.Passed ? "PASS" : "FAIL")} {check.Name}: {check.Detail}");
        }
        return checks.All(check => check.Passed) ? 0 : 1;
    }

    private static async Task CheckCommandAsync(
        ICollection<Check> checks,
        string root,
        string name,
        string command,
        IReadOnlyList<string> args)
    {
        try
        {
            var result = await ProcessRunner.CaptureAsync(command, args, root);
            checks.Add(new(name, result.ExitCode == 0,
                result.ExitCode == 0 ? result.StandardOutput.Trim() : result.StandardError.Trim()));
        }
        catch (Exception exception)
        {
            checks.Add(new(name, false, exception.Message));
        }
    }

    private static async Task<string?> DetectRuntimeAsync(string root)
    {
        foreach (var runtime in new[] { "docker", "podman" })
        {
            try
            {
                if ((await ProcessRunner.CaptureAsync(runtime, ["info"], root)).ExitCode == 0
                    && (await ProcessRunner.CaptureAsync(runtime, ["compose", "version"], root)).ExitCode == 0)
                {
                    return runtime;
                }
            }
            catch
            {
            }
        }
        return null;
    }

    private static async Task<Dictionary<string, string>> AspireParametersAsync(string root)
    {
        var result = await ProcessRunner.CaptureAsync(
            "aspire",
            ["secret", "list", "--format", "Json", "--non-interactive", "--nologo"],
            root);
        if (result.ExitCode != 0)
        {
            return [];
        }
        using var document = JsonDocument.Parse(result.StandardOutput);
        return document.RootElement.EnumerateObject()
            .Where(item => item.Name.StartsWith("Parameters:", StringComparison.Ordinal)
                && item.Value.ValueKind == JsonValueKind.String)
            .ToDictionary(
                item => item.Name["Parameters:".Length..],
                item => item.Value.GetString() ?? "",
                StringComparer.Ordinal);
    }

    private static Dictionary<string, string?> BuildValidationEnvironment(
        IReadOnlyDictionary<string, string> parameters)
        => new()
        {
            ["VPN_PROVIDER"] = Parameter(parameters, "vpn-provider", "protonvpn"),
            ["VPN_COUNTRIES"] = Parameter(parameters, "vpn-countries", "Netherlands"),
            ["VPN_WIREGUARD_KEY"] = Parameter(parameters, "vpn-wireguard-key", ""),
            ["TIMEZONE"] = Parameter(parameters, "timezone", "UTC"),
            ["JELLYFIN_LANGUAGE"] = Parameter(parameters, "jellyfin-language", "pt-BR"),
            ["SUBTITLE_LANGUAGES"] = Parameter(parameters, "subtitle-languages", "pt-BR"),
            ["MINIMUM_SEEDERS"] = Parameter(parameters, "minimum-seeders", "1"),
            ["USE_ORIGINAL_TITLE"] = Parameter(parameters, "use-original-title", "false"),
            ["TRAEFIK_DOMAIN"] = Parameter(parameters, "traefik-domain", Ingress.DefaultTraefikDomain),
            ["TRAEFIK_TLS_MODE"] = Parameter(parameters, "traefik-tls-mode", "local"),
            ["TRAEFIK_ACME_EMAIL"] = Parameter(parameters, "traefik-acme-email", ""),
            ["CF_DNS_API_TOKEN"] = Parameter(parameters, "cloudflare-dns-api-token", ""),
            ["INGRESS_ADMIN_USER"] = Parameter(parameters, "ingress-admin-user", "admin"),
            ["INGRESS_ADMIN_PASSWORD"] = Parameter(parameters, "ingress-admin-password", "generated"),
            ["AUTHELIA_SESSION_SECRET"] = Parameter(parameters, "authelia-session-secret", new string('s', 64)),
            ["AUTHELIA_STORAGE_ENCRYPTION_KEY"] = Parameter(parameters, "authelia-storage-encryption-key", new string('e', 64)),
        };

    private static string Parameter(
        IReadOnlyDictionary<string, string> values,
        string name,
        string fallback)
        => Environment.GetEnvironmentVariable($"Parameters__{name.Replace('-', '_')}")
            ?? values.GetValueOrDefault(name)
            ?? fallback;
}
