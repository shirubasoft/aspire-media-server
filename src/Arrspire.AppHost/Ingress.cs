namespace Arrspire.AppHost;

internal readonly record struct IngressPorts(int Http, int Https);

internal static class Ingress
{
    public const string DefaultTraefikDomain = "192.168.0.15.nip.io";

    public static IngressPorts ResolvePorts(
        bool rootlessPodman,
        IReadOnlyDictionary<string, string?>? environment = null)
    {
        environment ??= Environment.GetEnvironmentVariables()
            .Cast<System.Collections.DictionaryEntry>()
            .ToDictionary(
                entry => (string)entry.Key,
                entry => entry.Value?.ToString(),
                StringComparer.Ordinal);

        var http = ResolvePort(
            "ARRSPIRE_INGRESS_HTTP_PORT",
            Get(environment, "ARRSPIRE_INGRESS_HTTP_PORT"),
            rootlessPodman ? 8080 : 80);
        var https = ResolvePort(
            "ARRSPIRE_INGRESS_HTTPS_PORT",
            Get(environment, "ARRSPIRE_INGRESS_HTTPS_PORT"),
            rootlessPodman ? 8443 : 443);

        if (http == https)
        {
            throw new InvalidOperationException("HTTP and HTTPS ingress ports must differ");
        }

        return new IngressPorts(http, https);
    }

    public static int PublishedTraefikHttpsPort(string compose)
    {
        var service = string.Empty;
        var inPorts = false;
        foreach (var line in compose.Split(["\r\n", "\n"], StringSplitOptions.None))
        {
            if (line.StartsWith("  ", StringComparison.Ordinal)
                && !line.StartsWith("    ", StringComparison.Ordinal)
                && line.EndsWith(':'))
            {
                service = line[2..^1];
                inPorts = false;
                continue;
            }

            if (service == "traefik" && line == "    ports:")
            {
                inPorts = true;
                continue;
            }

            if (!inPorts)
            {
                continue;
            }

            var quoted = line.IndexOf(":443", StringComparison.Ordinal);
            if (quoted >= 0)
            {
                var start = quoted - 1;
                while (start >= 0 && char.IsAsciiDigit(line[start]))
                {
                    start--;
                }

                if (int.TryParse(line[(start + 1)..quoted], out var port))
                {
                    return ResolvePort("published Traefik HTTPS port", port.ToString(), 443);
                }
            }

            if (line.StartsWith("    ", StringComparison.Ordinal)
                && line.Length > 4
                && !char.IsWhiteSpace(line[4]))
            {
                break;
            }
        }

        return 443;
    }

    public static string HttpsServiceUrl(string service, string domain, int httpsPort)
        => $"https://{service}.{domain}{(httpsPort == 443 ? string.Empty : $":{httpsPort}")}";

    public static string TraefikHttpsRedirectTarget(int httpsPort)
        => $":{ResolvePort("Traefik HTTPS redirect port", httpsPort.ToString(), 443)}";

    private static int ResolvePort(string name, string? value, int fallback)
    {
        var candidate = string.IsNullOrEmpty(value) ? fallback : int.TryParse(value, out var parsed) ? parsed : -1;
        if (candidate is < 1 or > 65535)
        {
            throw new InvalidOperationException($"{name} must be a valid TCP port (1-65535)");
        }

        return candidate;
    }

    private static string? Get(IReadOnlyDictionary<string, string?> environment, string name)
        => environment.TryGetValue(name, out var value) ? value : null;
}
