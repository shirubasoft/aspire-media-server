using System.Text.RegularExpressions;

namespace Arrspire.Operator;

internal static partial class PublicationValidator
{
    public static void Validate(
        string compose,
        int expectedHttpPort,
        int expectedHttpsPort)
    {
        var published = PublishedPorts(compose);
        if (published.Count != 1 || !published.ContainsKey("traefik"))
        {
            throw new InvalidOperationException(
                "Only Traefik may publish host ports by default.");
        }
        var traefikPorts = published["traefik"];
        if (traefikPorts.Count != 2
            || !traefikPorts.Contains($"{expectedHttpPort}:80")
            || !traefikPorts.Contains($"{expectedHttpsPort}:443"))
        {
            throw new InvalidOperationException(
                "Traefik must publish exactly the configured HTTP and HTTPS ports.");
        }

        RequireSettings(
            ServiceSection(compose, "traefik"),
            "traefik",
            [
                "TRAEFIK_API_INSECURE: \"false\"",
                "TRAEFIK_ENTRYPOINTS_WEB_HTTP_REDIRECTIONS_ENTRYPOINT_SCHEME: \"https\"",
                "TRAEFIK_ENTRYPOINTS_WEB_HTTP_REDIRECTIONS_ENTRYPOINT_TO:",
                "CF_DNS_API_TOKEN: \"${CLOUDFLARE_DNS_API_TOKEN}\"",
                "TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_STORAGE: \"/acme/acme.json\"",
                "TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_DNSCHALLENGE: \"true\"",
                "TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_DNSCHALLENGE_RESOLVERS: \"1.1.1.1:53,8.8.8.8:53\"",
            ]);
        var traefik = ServiceSection(compose, "traefik");
        if (traefik.Contains(
            "TRAEFIK_API_INSECURE: \"true\"",
            StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "Published Compose enables the insecure Traefik API.");
        }
        if (traefik.Contains(
            "/etc/traefik/traefik.yml",
            StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "Traefik static configuration must come from one source.");
        }

        RequireSettings(
            ServiceSection(compose, "arrspire-dashboard"),
            "arrspire-dashboard",
            [
                "ASPIRE_DASHBOARD_FORWARDEDHEADERS_ENABLED: \"true\"",
                "DOTNET_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS: \"true\"",
            ]);
        RequireSettings(
            ServiceSection(compose, "duplicati"),
            "duplicati",
            ["DUPLICATI__WEBSERVICE_ALLOWED_HOSTNAMES: \"*\""]);
        RequireSettings(
            ServiceSection(compose, "authelia"),
            "authelia",
            [
                "AUTHELIA_SESSION_SECRET_FILE: \"/secrets/session-secret\"",
                "AUTHELIA_STORAGE_ENCRYPTION_KEY_FILE: \"/secrets/storage-encryption-key\"",
            ]);
        RequireSettings(
            ServiceSection(compose, "diun"),
            "diun",
            ["DIUN_NOTIF_WEBHOOK_ENDPOINT: \"http://notifier:8080/diun\""]);
        RequireSettings(
            ServiceSection(compose, "reconciler"),
            "reconciler",
            ["Services__Notifier: \"http://notifier:8080\""]);
        RequireSettings(
            ServiceSection(compose, "qbittorrent"),
            "qbittorrent",
            ["network_mode: \"service:gluetun\""]);
        RequireSettings(
            ServiceSection(compose, "prowlarr"),
            "prowlarr",
            ["network_mode: \"service:gluetun\""]);

        var homepage = ServiceSection(compose, "homepage");
        RequireSettings(
            homepage,
            "homepage",
            [
                "HOMEPAGE_ALLOWED_HOSTS:",
                "target: \"/app/config\"",
                "read_only: true",
            ]);

        var notifier = ServiceSection(compose, "notifier");
        RequireSettings(
            notifier,
            "notifier",
            [
                "Ntfy__Token: \"${NTFY_TOKEN}\"",
                "Ntfy__Click: \"https://",
            ]);
        if (notifier.Contains(
            "Ntfy__Click: \"http://homepage",
            StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "Notification links must use the public HTTPS ingress.");
        }
        if (notifier.Contains("target: \"/media\"", StringComparison.Ordinal)
            || notifier.Contains("target: \"/downloads\"", StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "The notification relay must not receive media or download mounts.");
        }

        foreach (var required in new[]
        {
            "homepage", "notifier", "reconciler", "bootstrap",
        })
        {
            if (string.IsNullOrEmpty(ServiceSection(compose, required)))
            {
                throw new InvalidOperationException(
                    $"Published Compose is missing required service: {required}");
            }
        }

        foreach (Match match in ImageRegex().Matches(compose))
        {
            var image = match.Groups[1].Value;
            if (!image.StartsWith("${", StringComparison.Ordinal)
                && !PinnedImageRegex().IsMatch(image))
            {
                throw new InvalidOperationException(
                    $"Published image is not immutable: {image}");
            }
        }
    }

    internal static string ServiceSection(string compose, string service)
    {
        var lines = compose.Split('\n');
        var start = Array.FindIndex(
            lines,
            line => line.TrimEnd('\r') == $"  {service}:");
        if (start < 0)
        {
            return string.Empty;
        }

        var end = start + 1;
        while (end < lines.Length
            && (!lines[end].StartsWith("  ", StringComparison.Ordinal)
                || lines[end].StartsWith("    ", StringComparison.Ordinal)
                || string.IsNullOrWhiteSpace(lines[end])))
        {
            end++;
        }
        return string.Join('\n', lines[start..end]);
    }

    private static void RequireSettings(
        string section,
        string service,
        IEnumerable<string> settings)
    {
        if (section.Length == 0)
        {
            throw new InvalidOperationException(
                $"Published Compose is missing required service: {service}");
        }
        foreach (var setting in settings)
        {
            if (!section.Contains(setting, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"{service} is missing required setting: {setting}");
            }
        }
    }

    internal static IReadOnlyDictionary<string, IReadOnlyList<string>> PublishedPorts(
        string compose)
    {
        var result = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
        string? service = null;
        List<string>? ports = null;
        foreach (var line in compose.Split('\n'))
        {
            var serviceMatch = ServiceRegex().Match(line);
            if (serviceMatch.Success)
            {
                service = serviceMatch.Groups[1].Value;
                ports = null;
                continue;
            }
            if (line == "    ports:")
            {
                if (service is null)
                {
                    throw new InvalidOperationException(
                        "Compose ports appeared outside a service.");
                }
                ports = [];
                result[service] = ports;
                continue;
            }
            if (ports is not null)
            {
                var port = PortRegex().Match(line);
                if (port.Success)
                {
                    ports.Add(port.Groups[1].Value);
                }
                else if (line.StartsWith("    ", StringComparison.Ordinal)
                    && !line.StartsWith("      ", StringComparison.Ordinal))
                {
                    ports = null;
                }
            }
        }
        return result;
    }

    [GeneratedRegex("^  ([a-z0-9][a-z0-9-]*):$")]
    private static partial Regex ServiceRegex();

    [GeneratedRegex("^      - \"([^\"]+)\"$")]
    private static partial Regex PortRegex();

    [GeneratedRegex("^\\s+image: \"([^\"]+)\"$", RegexOptions.Multiline)]
    private static partial Regex ImageRegex();

    [GeneratedRegex("@sha256:[a-f0-9]{64}$")]
    private static partial Regex PinnedImageRegex();
}
