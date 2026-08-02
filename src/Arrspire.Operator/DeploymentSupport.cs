using System.Net;
using System.Net.Http.Headers;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Arrspire.Operator;

internal sealed record PodmanRecovery(
    IReadOnlyList<string> Dependents,
    IReadOnlyList<string> Infrastructure);

internal static partial class DeploymentSupport
{
    private const string CloudflareApi = "https://api.cloudflare.com/client/v4";

    public static bool IsPodmanNetworkDependencyFailure(string output)
        => output.Contains(
                "has dependent containers which must be removed before it",
                StringComparison.OrdinalIgnoreCase)
            && output.Contains("gluetun", StringComparison.OrdinalIgnoreCase);

    public static string? SelectComposeProjectName(
        string composeListJson,
        string composeFile)
    {
        var documentStart = composeListJson.IndexOf('[', StringComparison.Ordinal);
        if (documentStart < 0)
        {
            return null;
        }
        using var document = JsonDocument.Parse(composeListJson[documentStart..]);
        var target = Path.GetFullPath(composeFile);
        var matches = document.RootElement.EnumerateArray()
            .Where(item => item.TryGetProperty("Name", out var name)
                && name.ValueKind == JsonValueKind.String
                && item.TryGetProperty("ConfigFiles", out _))
            .Where(item => ConfigFiles(item.GetProperty("ConfigFiles"))
                .Any(file => Path.GetFullPath(file) == target))
            .Select(item => item.GetProperty("Name").GetString()!)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        return matches.Length switch
        {
            0 => null,
            1 => matches[0],
            _ => throw new InvalidOperationException(
                $"Multiple Compose projects reference {target}: "
                + string.Join(", ", matches)),
        };
    }

    public static IReadOnlyList<string> ComposeArguments(
        string? project,
        string environmentFile,
        string composeFile,
        IReadOnlyList<string> command)
    {
        var arguments = new List<string> { "compose" };
        if (!string.IsNullOrWhiteSpace(project))
        {
            arguments.AddRange(["--project-name", project]);
        }
        arguments.AddRange(
        [
            "--env-file", environmentFile,
            "--file", composeFile,
        ]);
        arguments.AddRange(command);
        return arguments;
    }

    public static PodmanRecovery? PodmanRecoveryPlan(
        string containersJson,
        string project)
    {
        using var document = JsonDocument.Parse(containersJson);
        var containers = document.RootElement.EnumerateArray()
            .Select(item =>
            {
                var id = item.TryGetProperty("Id", out var idProperty)
                    ? idProperty.GetString()
                    : null;
                var labels = item.TryGetProperty("Labels", out var labelsProperty)
                    ? labelsProperty
                    : default;
                var service = labels.ValueKind == JsonValueKind.Object
                    && labels.TryGetProperty("com.docker.compose.project", out var projectProperty)
                    && projectProperty.GetString() == project
                    && labels.TryGetProperty("com.docker.compose.service", out var serviceProperty)
                        ? serviceProperty.GetString()
                        : null;
                return (Id: id, Service: service);
            })
            .Where(item => item.Id is not null && item.Service is not null)
            .ToArray();
        if (!containers.Any(item => item.Service == "gluetun"))
        {
            return null;
        }
        var dependents = containers
            .Where(item => item.Service is "qbittorrent" or "prowlarr")
            .Select(item => item.Id!)
            .ToArray();
        return dependents.Length == 0
            ? null
            : new(
                dependents,
                containers
                    .Where(item => item.Service is "gluetun" or "traefik")
                    .Select(item => item.Id!)
                    .ToArray());
    }

    public static async Task<string?> ReconcileHomepageDnsAsync(
        string environmentFile)
    {
        var values = Deployment.ReadEnvironment(environmentFile);
        if (values.GetValueOrDefault("TRAEFIK_TLS_MODE") != "cloudflare-acme")
        {
            return null;
        }
        var domain = values.GetValueOrDefault("TRAEFIK_DOMAIN")
            ?? throw new InvalidOperationException(
                "Cloudflare deployment is missing TRAEFIK_DOMAIN.");
        var token = values.GetValueOrDefault("CLOUDFLARE_DNS_API_TOKEN")
            ?? throw new InvalidOperationException(
                "Cloudflare deployment is missing CLOUDFLARE_DNS_API_TOKEN.");
        using var client = new HttpClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", token);
        var zones = await CloudflareAsync(
            client, HttpMethod.Get, "/zones?per_page=50");
        var zone = zones.AsArray()
            .OfType<JsonObject>()
            .Where(item => item["name"]?.GetValue<string>() is { } name
                && (domain == name || domain.EndsWith($".{name}", StringComparison.Ordinal)))
            .OrderByDescending(item => item["name"]!.GetValue<string>().Length)
            .FirstOrDefault()
            ?? throw new InvalidOperationException(
                $"No token-accessible Cloudflare zone owns {domain}.");
        var zoneId = zone["id"]!.GetValue<string>();
        var exact = await CloudflareAsync(
            client,
            HttpMethod.Get,
            $"/zones/{zoneId}/dns_records?name={Uri.EscapeDataString(domain)}&per_page=100");
        var exactAddress = exact.AsArray().OfType<JsonObject>().FirstOrDefault(
            record => record["type"]?.GetValue<string>() is "A" or "AAAA");
        if (exactAddress is not null)
        {
            return exactAddress["content"]?.GetValue<string>();
        }
        var wildcardName = $"*.{domain}";
        var wildcard = await CloudflareAsync(
            client,
            HttpMethod.Get,
            $"/zones/{zoneId}/dns_records?name={Uri.EscapeDataString(wildcardName)}&per_page=100");
        var source = wildcard.AsArray().OfType<JsonObject>().FirstOrDefault(
            record => record["type"]?.GetValue<string>() is "A" or "AAAA")
            ?? throw new InvalidOperationException(
                $"Create a DNS-only A/AAAA record for {domain} or {wildcardName}.");
        var payload = new JsonObject
        {
            ["type"] = source["type"]?.DeepClone(),
            ["name"] = domain,
            ["content"] = source["content"]?.DeepClone(),
            ["ttl"] = source["ttl"]?.DeepClone() ?? 1,
            ["proxied"] = false,
            ["comment"] = "Managed by the Arrspire deployment pipeline",
        };
        var created = await CloudflareAsync(
            client,
            HttpMethod.Post,
            $"/zones/{zoneId}/dns_records",
            payload);
        return created["content"]?.GetValue<string>();
    }

    public static async Task VerifyHomepageAsync(
        string composeFile,
        string environmentFile,
        string? address)
    {
        var values = Deployment.ReadEnvironment(environmentFile);
        if (values.GetValueOrDefault("TRAEFIK_TLS_MODE") != "cloudflare-acme")
        {
            return;
        }
        var domain = values.GetValueOrDefault("TRAEFIK_DOMAIN")
            ?? throw new InvalidOperationException("Missing TRAEFIK_DOMAIN.");
        var port = Firewall.PublishedHttpsPort(await File.ReadAllTextAsync(composeFile));
        var timeout = int.TryParse(
            Environment.GetEnvironmentVariable("ARRSPIRE_DEPLOY_VERIFY_TIMEOUT_MS"),
            out var configured)
            && configured > 0
            ? configured
            : 180_000;
        var deadline = DateTimeOffset.UtcNow.AddMilliseconds(timeout);
        Exception? lastError = null;
        string? lastObservation = null;
        while (DateTimeOffset.UtcNow < deadline)
        {
            try
            {
                var root = await IngressStatusAsync(domain, port, address);
                var auth = await IngressStatusAsync($"auth.{domain}", port, address);
                lastObservation = $"homepage HTTP {(int)root.StatusCode}"
                    + $" -> {root.Location}; auth HTTP {(int)auth.StatusCode}";
                if (IsExpectedHomepageRedirect(
                        root.StatusCode,
                        root.Location,
                        domain,
                        port)
                    && auth.StatusCode == HttpStatusCode.OK)
                {
                    Console.WriteLine(
                        $"Homepage is ready with trusted TLS at https://{domain}:{port}/");
                    return;
                }
            }
            catch (Exception exception)
            {
                lastError = exception;
            }
            await Task.Delay(TimeSpan.FromSeconds(2));
        }
        throw new InvalidOperationException(
            $"Homepage verification timed out: "
            + (lastError?.Message ?? lastObservation ?? "no response"));
    }

    internal static bool IsExpectedHomepageRedirect(
        HttpStatusCode status,
        Uri? location,
        string domain,
        int port)
        => status == HttpStatusCode.Redirect
            && location is not null
            && location.IsAbsoluteUri
            && location.Scheme == Uri.UriSchemeHttps
            && string.Equals(
                location.Host,
                $"auth.{domain}",
                StringComparison.OrdinalIgnoreCase)
            && location.Port == port
            && location.AbsolutePath == "/";

    private static IEnumerable<string> ConfigFiles(JsonElement value)
        => value.ValueKind switch
        {
            JsonValueKind.Array => value.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.String)
                .Select(item => item.GetString()!),
            JsonValueKind.String => value.GetString()!
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
            _ => [],
        };

    private static async Task<JsonNode> CloudflareAsync(
        HttpClient client,
        HttpMethod method,
        string path,
        JsonNode? body = null)
    {
        using var request = new HttpRequestMessage(method, CloudflareApi + path)
        {
            Content = body is null
                ? null
                : new StringContent(
                    body.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        using var response = await client.SendAsync(request);
        var document = JsonNode.Parse(await response.Content.ReadAsStringAsync())
            as JsonObject;
        if (!response.IsSuccessStatusCode
            || document?["success"]?.GetValue<bool>() is not true)
        {
            throw new InvalidOperationException(
                $"Cloudflare API request failed with HTTP {(int)response.StatusCode}.");
        }
        return document["result"]?.DeepClone()
            ?? throw new InvalidOperationException("Cloudflare response had no result.");
    }

    private static async Task<(HttpStatusCode StatusCode, Uri? Location)> IngressStatusAsync(
        string hostname,
        int port,
        string? address)
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            ConnectCallback = async (context, cancellationToken) =>
            {
                var socket = new Socket(SocketType.Stream, ProtocolType.Tcp);
                await socket.ConnectAsync(
                    address ?? context.DnsEndPoint.Host,
                    context.DnsEndPoint.Port,
                    cancellationToken);
                return new NetworkStream(socket, ownsSocket: true);
            },
            SslOptions = new SslClientAuthenticationOptions
            {
                TargetHost = hostname,
            },
        };
        using var client = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(5),
        };
        client.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("text/html"));
        using var response = await client.GetAsync(
            $"https://{hostname}{(port == 443 ? "" : $":{port}")}/");
        return (response.StatusCode, response.Headers.Location);
    }
}
