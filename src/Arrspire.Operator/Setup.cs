using System.Text.Json;
using Arrspire.AppHost;
using Arrspire.ControlPlane;

namespace Arrspire.Operator;

internal static class Setup
{
    private sealed record Values(
        string VpnProvider,
        string VpnCountries,
        string VpnWireguardKey,
        string Timezone,
        string JellyfinLanguage,
        string SubtitleLanguages,
        string TraefikDomain,
        string TraefikTlsMode,
        string TraefikAcmeEmail,
        string CloudflareDnsApiToken,
        string DataPath,
        string MediaPath,
        string DownloadsPath,
        string NtfyEndpoint,
        string NtfyTopic,
        string NtfyToken);

    public static async Task<int> RunAsync(string root, IReadOnlyList<string> args)
    {
        var nonInteractive = args.Contains("--non-interactive");
        var existing = await ExistingParametersAsync(root);
        var paths = ArrspirePaths.Resolve(Path.Combine(root, "Arrspire.AppHost"));
        string Current(string name, string fallback)
            => Environment.GetEnvironmentVariable(
                    $"Parameters__{name.Replace('-', '_')}")
                ?? existing.GetValueOrDefault(name)
                ?? fallback;
        string Ask(string label, string fallback)
        {
            if (nonInteractive)
            {
                return fallback;
            }
            Console.Write($"{label} [{fallback}]: ");
            return Console.ReadLine()?.Trim() is { Length: > 0 } value ? value : fallback;
        }
        string AskSecret(string label, string fallback)
        {
            if (nonInteractive)
            {
                return fallback;
            }
            Console.Write($"{label}{(fallback.Length > 0 ? " [Enter keeps existing]" : "")}: ");
            var value = new List<char>();
            while (Console.ReadKey(intercept: true) is var key
                && key.Key != ConsoleKey.Enter)
            {
                if (key.Key == ConsoleKey.Backspace && value.Count > 0)
                {
                    value.RemoveAt(value.Count - 1);
                    Console.Write("\b \b");
                }
                else if (!char.IsControl(key.KeyChar))
                {
                    value.Add(key.KeyChar);
                    Console.Write('*');
                }
            }
            Console.WriteLine();
            return value.Count == 0 ? fallback : new string([.. value]);
        }
        bool Confirm(string label)
        {
            if (nonInteractive)
            {
                return true;
            }
            Console.Write($"{label} [y/N]: ");
            return Console.ReadLine()?.Trim() is { } response
                && response.Equals("y", StringComparison.OrdinalIgnoreCase);
        }

        Console.WriteLine(nonInteractive
            ? "Arrspire non-interactive setup"
            : "Arrspire guided C# setup (Enter accepts the shown default)");
        var values = new Values(
            Ask("Gluetun VPN provider", Current("vpn-provider", "protonvpn")),
            Ask(
                "VPN exit countries",
                Current("vpn-countries", ArrspireParameters.DefaultVpnCountries)),
            AskSecret("WireGuard private key", Current("vpn-wireguard-key", "")),
            Ask("IANA timezone", Current("timezone", DefaultTimezone())),
            Ask("Jellyfin language", Current("jellyfin-language", "pt-BR")),
            Ask("Subtitle languages", Current("subtitle-languages", "pt-BR")),
            Ask("Private ingress domain", Current("traefik-domain", Ingress.DefaultTraefikDomain)),
            Ask("TLS mode", Current("traefik-tls-mode", "local")),
            Ask("Let's Encrypt email", Current("traefik-acme-email", "")),
            AskSecret("Cloudflare DNS API token", Current("cloudflare-dns-api-token", "")),
            Path.GetFullPath(Ask("Persistent data path", paths.Data)),
            Path.GetFullPath(Ask("Media path", paths.Media)),
            Path.GetFullPath(Ask("Downloads path", paths.Downloads)),
            Ask("ntfy endpoint", Current("ntfy-endpoint", "https://ntfy.sh")),
            AskSecret("Private ntfy topic", Current("ntfy-topic", "")),
            AskSecret("ntfy access token", Current("ntfy-token", "")));

        Validate(values);
        ArrspirePaths.ValidateLayout(new Dictionary<string, string>
        {
            ["data"] = values.DataPath,
            ["media"] = values.MediaPath,
            ["downloads"] = values.DownloadsPath,
        });
        Console.WriteLine();
        Console.WriteLine($"VPN: {values.VpnProvider} / {values.VpnCountries}");
        Console.WriteLine(
            $"Locale: {values.Timezone} / {values.JellyfinLanguage}");
        Console.WriteLine(
            $"Ingress: {values.TraefikDomain} ({values.TraefikTlsMode})");
        Console.WriteLine($"Data: {values.DataPath}");
        Console.WriteLine($"Media: {values.MediaPath}");
        Console.WriteLine($"Downloads: {values.DownloadsPath}");
        Console.WriteLine(
            $"Notifications: {(values.NtfyTopic.Length > 0 ? "enabled" : "disabled")}");
        if (!Confirm("Save this configuration?"))
        {
            Console.WriteLine("Setup cancelled without making changes.");
            return 1;
        }

        foreach (var directory in new[]
        {
            values.DataPath, values.MediaPath, values.DownloadsPath,
        })
        {
            Directory.CreateDirectory(directory);
        }

        var parameters = new Dictionary<string, string>
        {
            ["vpn-provider"] = values.VpnProvider,
            ["vpn-wireguard-key"] = values.VpnWireguardKey,
            ["vpn-countries"] = values.VpnCountries,
            ["timezone"] = values.Timezone,
            ["jellyfin-language"] = values.JellyfinLanguage,
            ["subtitle-languages"] = values.SubtitleLanguages,
            ["traefik-domain"] = values.TraefikDomain,
            ["traefik-tls-mode"] = values.TraefikTlsMode,
            ["traefik-acme-email"] = values.TraefikAcmeEmail,
            ["cloudflare-dns-api-token"] = values.CloudflareDnsApiToken,
            ["ntfy-endpoint"] = values.NtfyEndpoint,
            ["ntfy-topic"] = values.NtfyTopic,
            ["ntfy-token"] = values.NtfyToken,
        };
        foreach (var (name, value) in parameters)
        {
            var exitCode = await ProcessRunner.InheritAsync(
                "aspire",
                ["secret", "set", $"Parameters:{name}", value, "--non-interactive", "--nologo"],
                root);
            if (exitCode != 0)
            {
                throw new InvalidOperationException($"Unable to save parameter {name}");
            }
        }

        var configDirectory = Path.Combine(root, ".arrspire");
        UnixPermissions.ProtectDirectory(configDirectory);
        var configPath = Path.Combine(configDirectory, "config.json");
        var temporary = configPath + $".{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
        var content = JsonSerializer.Serialize(
            new
            {
                schemaVersion = 1,
                paths = new
                {
                    data = values.DataPath,
                    media = values.MediaPath,
                    downloads = values.DownloadsPath,
                },
            },
            new JsonSerializerOptions { WriteIndented = true }) + "\n";
        var fileOptions = new FileStreamOptions
        {
            Access = FileAccess.Write,
            Mode = FileMode.CreateNew,
            Share = FileShare.None,
        };
        if (!OperatingSystem.IsWindows())
        {
            fileOptions.UnixCreateMode =
                UnixFileMode.UserRead | UnixFileMode.UserWrite;
        }
        await using (var stream = new FileStream(temporary, fileOptions))
        await using (var writer = new StreamWriter(stream))
        {
            await writer.WriteAsync(content);
        }
        File.Move(temporary, configPath, true);
        UnixPermissions.ProtectFile(configPath);

        Console.WriteLine($"Saved local paths to {configPath}");
        Console.WriteLine("Next: run `dotnet run --project Arrspire.Operator -- doctor`.");
        return 0;
    }

    private static void Validate(Values values)
    {
        Validation.ValidateConfiguration(new Dictionary<string, string?>
        {
            ["VPN_PROVIDER"] = values.VpnProvider,
            ["VPN_COUNTRIES"] = values.VpnCountries,
            ["VPN_WIREGUARD_KEY"] = values.VpnWireguardKey,
            ["TIMEZONE"] = values.Timezone,
            ["JELLYFIN_LANGUAGE"] = values.JellyfinLanguage,
            ["SUBTITLE_LANGUAGES"] = values.SubtitleLanguages,
            ["MINIMUM_SEEDERS"] = "1",
            ["USE_ORIGINAL_TITLE"] = "false",
            ["TRAEFIK_DOMAIN"] = values.TraefikDomain,
            ["TRAEFIK_TLS_MODE"] = values.TraefikTlsMode,
            ["TRAEFIK_ACME_EMAIL"] = values.TraefikAcmeEmail,
            ["CF_DNS_API_TOKEN"] = values.CloudflareDnsApiToken,
            ["INGRESS_ADMIN_USER"] = "admin",
            ["INGRESS_ADMIN_PASSWORD"] = "validated-during-setup",
            ["AUTHELIA_SESSION_SECRET"] = new string('s', 64),
            ["AUTHELIA_STORAGE_ENCRYPTION_KEY"] = new string('e', 64),
        });
        _ = new NtfyOptions
        {
            Endpoint = values.NtfyEndpoint,
            Topic = values.NtfyTopic,
            Token = values.NtfyToken,
        }.ToConfiguration();
    }

    internal static string DefaultTimezone(string? localId = null)
    {
        var id = localId ?? TimeZoneInfo.Local.Id;
        if (TimeZoneInfo.TryConvertWindowsIdToIanaId(id, out var iana))
        {
            return iana;
        }
        return id.Contains('/', StringComparison.Ordinal) ? id : "UTC";
    }

    private static async Task<Dictionary<string, string>> ExistingParametersAsync(
        string root)
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
                .Where(item => item.Name.StartsWith("Parameters:", StringComparison.Ordinal)
                    && item.Value.ValueKind == JsonValueKind.String)
                .ToDictionary(
                    item => item.Name["Parameters:".Length..],
                    item => item.Value.GetString() ?? "",
                    StringComparer.Ordinal)
            : [];
    }
}
