using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using System.Text.Json.Nodes;
using Arrspire.AppHost;
using Arrspire.ControlPlane;

namespace Arrspire.Operator;

internal enum DoctorCheckStatus
{
    Pass,
    Warn,
    Fail,
}

internal sealed record DoctorCheck(
    string Name,
    DoctorCheckStatus Status,
    string Detail,
    string? Fix = null);

internal static class Doctor
{
    public static async Task<int> RunAsync(string root)
    {
        var checks = new List<DoctorCheck>();
        await CheckCommandAsync(
            checks,
            root,
            "Aspire environment",
            "aspire",
            ["doctor", "--format", "Json", "--non-interactive", "--nologo"]);

        var parameters = await AspireParametersAsync(root);
        try
        {
            Validation.ValidateConfiguration(BuildValidationEnvironment(parameters));
            _ = new NtfyOptions
            {
                Endpoint = Parameter(
                    parameters,
                    "ntfy-endpoint",
                    "https://ntfy.sh"),
                Topic = Parameter(parameters, "ntfy-topic", ""),
                Token = Parameter(parameters, "ntfy-token", ""),
            }.ToConfiguration();
            checks.Add(new(
                "Aspire parameters",
                DoctorCheckStatus.Pass,
                "provider, locale, ingress, notifications, and optional pairs are valid"));
        }
        catch (Exception exception)
        {
            checks.Add(new(
                "Aspire parameters",
                DoctorCheckStatus.Fail,
                exception.Message,
                "Run setup and correct the reported value."));
        }

        ArrspirePaths? paths = null;
        try
        {
            paths = ArrspirePaths.Resolve(Path.Combine(root, "Arrspire.AppHost"));
            ArrspirePaths.ValidateLayout(new Dictionary<string, string>
            {
                ["data"] = paths.Data,
                ["media"] = paths.Media,
                ["downloads"] = paths.Downloads,
            });
            var configPath = Path.Combine(root, ".arrspire", "config.json");
            checks.Add(File.Exists(configPath)
                ? new("Operator config", DoctorCheckStatus.Pass, configPath)
                : new(
                    "Operator config",
                    DoctorCheckStatus.Warn,
                    "using default or environment-provided paths",
                    "Run setup to persist local path choices."));

            foreach (var (name, path) in new[]
            {
                ("Data path", paths.Data),
                ("Media path", paths.Media),
                ("Downloads path", paths.Downloads),
            })
            {
                CheckDirectory(checks, name, path);
            }

            CheckContainerSocket(checks, paths.ContainerSocket);
            var ports = Ingress.ResolvePorts(paths.RootlessPodman);
            await CheckPortAsync(checks, "HTTP ingress", ports.Http);
            await CheckPortAsync(checks, "HTTPS ingress", ports.Https);
        }
        catch (Exception exception)
        {
            checks.Add(new(
                "Path layout",
                DoctorCheckStatus.Fail,
                exception.Message,
                "Run setup and choose three non-overlapping absolute directories."));
        }

        var domain = Parameter(
            parameters,
            "traefik-domain",
            Ingress.DefaultTraefikDomain);
        foreach (var host in new[] { domain, $"auth.{domain}", $"jellyfin.{domain}" })
        {
            try
            {
                var addresses = await Dns.GetHostAddressesAsync(host);
                checks.Add(new(
                    $"DNS {host}",
                    addresses.Length > 0
                        ? DoctorCheckStatus.Pass
                        : DoctorCheckStatus.Fail,
                    addresses.Length > 0
                        ? string.Join(", ", addresses.Select(address => address.ToString()))
                        : "hostname does not resolve"));
            }
            catch (Exception exception)
            {
                checks.Add(new(
                    $"DNS {host}",
                    DoctorCheckStatus.Fail,
                    exception.Message,
                    "Create private DNS records or use a server-address.nip.io domain."));
            }
        }

        if (paths is not null)
        {
            CheckTls(
                checks,
                Parameter(parameters, "traefik-tls-mode", "local"),
                domain,
                paths.Data,
                parameters);
            CheckPersistedStatus(checks, paths.Data);
        }

        Console.WriteLine("Arrspire doctor\n");
        foreach (var check in checks)
        {
            var marker = check.Status switch
            {
                DoctorCheckStatus.Pass => "PASS",
                DoctorCheckStatus.Warn => "WARN",
                _ => "FAIL",
            };
            Console.WriteLine($"{marker} {check.Name}: {check.Detail}");
            if (check.Fix is not null)
            {
                Console.WriteLine($"  {check.Fix}");
            }
        }

        var failures = checks.Count(check => check.Status == DoctorCheckStatus.Fail);
        var warnings = checks.Count(check => check.Status == DoctorCheckStatus.Warn);
        var passed = checks.Count - failures - warnings;
        Console.WriteLine($"\n{passed} passed, {warnings} warnings, {failures} failures");
        return failures == 0 ? 0 : 1;
    }

    internal static DoctorCheck DiskSpaceCheck(string name, long availableBytes)
    {
        var gib = availableBytes / Math.Pow(1024, 3);
        var detail = $"{gib:F1} GiB available";
        return gib switch
        {
            < 2 => new(
                name,
                DoctorCheckStatus.Fail,
                detail,
                "Free at least 2 GiB before starting Arrspire."),
            < 10 => new(
                name,
                DoctorCheckStatus.Warn,
                detail,
                "Free disk space soon; media automation can consume storage quickly."),
            _ => new(name, DoctorCheckStatus.Pass, detail),
        };
    }

    internal static Dictionary<string, string?> BuildValidationEnvironment(
        IReadOnlyDictionary<string, string> parameters)
    {
        var environment = new Dictionary<string, string?>
        {
            ["VPN_PROVIDER"] = Parameter(parameters, "vpn-provider", "protonvpn"),
            ["VPN_COUNTRIES"] = Parameter(
                parameters,
                "vpn-countries",
                ArrspireParameters.DefaultVpnCountries),
            ["VPN_WIREGUARD_KEY"] = Parameter(parameters, "vpn-wireguard-key", ""),
            ["TIMEZONE"] = Parameter(parameters, "timezone", "UTC"),
            ["JELLYFIN_LANGUAGE"] = Parameter(parameters, "jellyfin-language", "pt-BR"),
            ["SUBTITLE_LANGUAGES"] = Parameter(parameters, "subtitle-languages", "pt-BR"),
            ["MINIMUM_SEEDERS"] = Parameter(parameters, "minimum-seeders", "1"),
            ["USE_ORIGINAL_TITLE"] = Parameter(parameters, "use-original-title", "false"),
            ["TRAEFIK_DOMAIN"] = Parameter(
                parameters,
                "traefik-domain",
                Ingress.DefaultTraefikDomain),
            ["TRAEFIK_TLS_MODE"] = Parameter(parameters, "traefik-tls-mode", "local"),
            ["TRAEFIK_ACME_EMAIL"] = Parameter(parameters, "traefik-acme-email", ""),
            ["CF_DNS_API_TOKEN"] = Parameter(
                parameters,
                "cloudflare-dns-api-token",
                ""),
            ["INGRESS_ADMIN_USER"] = Parameter(parameters, "ingress-admin-user", "admin"),
            ["INGRESS_ADMIN_PASSWORD"] = Parameter(
                parameters,
                "ingress-admin-password",
                "generated"),
            ["AUTHELIA_SESSION_SECRET"] = Parameter(
                parameters,
                "authelia-session-secret",
                new string('s', 64)),
            ["AUTHELIA_STORAGE_ENCRYPTION_KEY"] = Parameter(
                parameters,
                "authelia-storage-encryption-key",
                new string('e', 64)),
        };
        foreach (var provider in new[]
        {
            "opensubtitlescom",
            "opensubtitlesorg",
            "legendasdivx",
            "legendasnet",
        })
        {
            environment[$"{provider.ToUpperInvariant()}_USER"] =
                Parameter(parameters, $"{provider}-user", "");
            environment[$"{provider.ToUpperInvariant()}_PASSWORD"] =
                Parameter(parameters, $"{provider}-password", "");
        }
        return environment;
    }

    private static void CheckDirectory(
        ICollection<DoctorCheck> checks,
        string name,
        string path)
    {
        try
        {
            if (!Directory.Exists(path))
            {
                throw new DirectoryNotFoundException($"{path} does not exist");
            }

            var probe = Path.Combine(
                path,
                $".arrspire-doctor-{Environment.ProcessId}-{Guid.NewGuid():N}");
            try
            {
                _ = Directory.EnumerateFileSystemEntries(path).Take(1).ToArray();
                using (File.Create(probe))
                {
                }
            }
            finally
            {
                File.Delete(probe);
            }

            checks.Add(new(
                name,
                DoctorCheckStatus.Pass,
                $"{Path.GetFullPath(path)} is readable, writable, and searchable"));
            var fullPath = Path.GetFullPath(path);
            var drive = DriveInfo.GetDrives()
                .Where(candidate => fullPath.StartsWith(
                    candidate.RootDirectory.FullName,
                    StringComparison.Ordinal))
                .OrderByDescending(candidate => candidate.RootDirectory.FullName.Length)
                .FirstOrDefault()
                ?? new DriveInfo(Path.GetPathRoot(fullPath)!);
            checks.Add(DiskSpaceCheck($"{name} capacity", drive.AvailableFreeSpace));
        }
        catch (Exception exception)
        {
            checks.Add(new(
                name,
                DoctorCheckStatus.Fail,
                $"{path}: {exception.Message}",
                "Run setup or correct directory ownership and permissions."));
        }
    }

    private static void CheckContainerSocket(
        ICollection<DoctorCheck> checks,
        string path)
    {
        try
        {
            _ = File.GetAttributes(path);
            checks.Add(new("Container socket", DoctorCheckStatus.Pass, path));
        }
        catch
        {
            checks.Add(new(
                "Container socket",
                DoctorCheckStatus.Fail,
                $"{path} is unavailable",
                "Start the container engine or set ARRSPIRE_CONTAINER_SOCKET."));
        }
    }

    private static async Task CheckPortAsync(
        ICollection<DoctorCheck> checks,
        string name,
        int port)
    {
        TcpListener? listener = null;
        try
        {
            listener = new TcpListener(IPAddress.Any, port);
            listener.Start();
            checks.Add(new(
                name,
                DoctorCheckStatus.Pass,
                $"port {port} is available"));
        }
        catch (SocketException exception)
        {
            checks.Add(new(
                name,
                DoctorCheckStatus.Warn,
                exception.SocketErrorCode == SocketError.AddressAlreadyInUse
                    ? $"port {port} is already in use"
                    : $"cannot bind port {port}: {exception.Message}",
                "This is expected when Arrspire is running; otherwise choose an ARRSPIRE_INGRESS_*_PORT override."));
        }
        finally
        {
            listener?.Stop();
        }
        await Task.CompletedTask;
    }

    private static void CheckTls(
        ICollection<DoctorCheck> checks,
        string mode,
        string domain,
        string dataPath,
        IReadOnlyDictionary<string, string> parameters)
    {
        if (mode == "cloudflare-acme")
        {
            var configured = Parameter(parameters, "traefik-acme-email", "").Length > 0
                && Parameter(parameters, "cloudflare-dns-api-token", "").Length > 0;
            checks.Add(new(
                "Public TLS inputs",
                configured ? DoctorCheckStatus.Pass : DoctorCheckStatus.Fail,
                configured
                    ? "ACME email and scoped Cloudflare token are configured"
                    : "ACME email or Cloudflare token is missing"));
            return;
        }

        var path = Path.Combine(
            dataPath,
            "traefik",
            "dynamic",
            "certs",
            "arrspire-local.crt");
        if (!File.Exists(path))
        {
            checks.Add(new(
                "Local TLS certificate",
                DoctorCheckStatus.Warn,
                "no generated local certificate was found",
                $"Run `dotnet run --project Arrspire.Operator -- tls-local {domain}` before browser access."));
            return;
        }

        try
        {
            using var certificate = X509CertificateLoader.LoadCertificateFromFile(path);
            var remaining = certificate.NotAfter.ToUniversalTime() - DateTime.UtcNow;
            var covered = certificate.MatchesHostname(
                    domain,
                    allowWildcards: true,
                    allowCommonName: true)
                && certificate.MatchesHostname(
                    $"auth.{domain}",
                    allowWildcards: true,
                    allowCommonName: true)
                && certificate.MatchesHostname(
                    $"jellyfin.{domain}",
                    allowWildcards: true,
                    allowCommonName: true);
            var healthy = remaining > TimeSpan.FromDays(30) && covered;
            checks.Add(new(
                "Local TLS certificate",
                healthy ? DoctorCheckStatus.Pass : DoctorCheckStatus.Warn,
                $"valid until {certificate.NotAfter:O}; domain coverage "
                    + (covered ? "ok" : "missing"),
                healthy ? null : "Regenerate the local TLS certificate."));
        }
        catch (Exception exception)
        {
            checks.Add(new(
                "Local TLS certificate",
                DoctorCheckStatus.Warn,
                exception.Message,
                "Regenerate the local TLS certificate."));
        }
    }

    private static void CheckPersistedStatus(
        ICollection<DoctorCheck> checks,
        string dataPath)
    {
        foreach (var phase in new[] { "bootstrap", "reconciliation" })
        {
            var path = Path.Combine(dataPath, "status", phase + ".json");
            try
            {
                var document = JsonNode.Parse(File.ReadAllText(path));
                var status = document?["status"]?.GetValue<string>() ?? "unknown";
                checks.Add(new(
                    $"{phase} status",
                    status switch
                    {
                        "ready" => DoctorCheckStatus.Pass,
                        "attention" or "pending" => DoctorCheckStatus.Warn,
                        _ => DoctorCheckStatus.Fail,
                    },
                    $"{status} ({document?["updatedAt"]?.GetValue<string>() ?? "unknown time"})"));
            }
            catch
            {
                checks.Add(new(
                    $"{phase} status",
                    DoctorCheckStatus.Warn,
                    "not available yet",
                    "Start or deploy Arrspire after setup."));
            }
        }
    }

    private static async Task CheckCommandAsync(
        ICollection<DoctorCheck> checks,
        string root,
        string name,
        string command,
        IReadOnlyList<string> args)
    {
        try
        {
            var result = await ProcessRunner.CaptureAsync(command, args, root);
            checks.Add(new(
                name,
                result.ExitCode == 0
                    ? DoctorCheckStatus.Pass
                    : DoctorCheckStatus.Fail,
                result.ExitCode == 0
                    ? result.StandardOutput.Trim()
                    : result.StandardError.Trim()));
        }
        catch (Exception exception)
        {
            checks.Add(new(name, DoctorCheckStatus.Fail, exception.Message));
        }
    }

    private static async Task<Dictionary<string, string>> AspireParametersAsync(
        string root)
    {
        try
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
            return document.RootElement.ValueKind == JsonValueKind.Object
                ? document.RootElement.EnumerateObject()
                    .Where(item => item.Name.StartsWith(
                            "Parameters:",
                            StringComparison.Ordinal)
                        && item.Value.ValueKind == JsonValueKind.String)
                    .ToDictionary(
                        item => item.Name["Parameters:".Length..],
                        item => item.Value.GetString() ?? "",
                        StringComparer.Ordinal)
                : [];
        }
        catch
        {
            return [];
        }
    }

    private static string Parameter(
        IReadOnlyDictionary<string, string> values,
        string name,
        string fallback)
        => Environment.GetEnvironmentVariable(
                $"Parameters__{name.Replace('-', '_')}")
            ?? values.GetValueOrDefault(name)
            ?? fallback;
}
