using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;

namespace Arrspire.ControlPlane;

internal static class Acceptance
{
    public static async Task VerifyAsync(
        ControlPlaneOptions options,
        ServiceEndpointOptions endpoints,
        IHttpClientFactory clientFactory,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        logger.LogInformation("Starting real-stack acceptance checks");
        var checks = new List<Task>
        {
            VerifyBootstrapFilesAsync(cancellationToken),
            VerifyIngressAsync(clientFactory, endpoints.Ingress, options.TraefikDomain, cancellationToken),
            VerifyQBittorrentAsync(clientFactory, endpoints.QBittorrent, options.QBittorrentPassword, cancellationToken),
            VerifyArrAsync(clientFactory, "sonarr", endpoints.Sonarr, "v3", ApiKeys.ReadArr("sonarr"), "/tv", cancellationToken),
            VerifyArrAsync(clientFactory, "radarr", endpoints.Radarr, "v3", ApiKeys.ReadArr("radarr"), "/movies", cancellationToken),
            VerifyArrAsync(clientFactory, "lidarr", endpoints.Lidarr, "v1", ApiKeys.ReadArr("lidarr"), "/music", cancellationToken),
            VerifyProwlarrAsync(clientFactory, endpoints.Prowlarr, ApiKeys.ReadArr("prowlarr"), cancellationToken),
            VerifyBazarrAsync(clientFactory, endpoints.Bazarr, await ApiKeys.ReadBazarrAsync(cancellationToken), cancellationToken),
            VerifyJellyfinAsync(clientFactory, endpoints.Jellyfin, cancellationToken),
            VerifySeerrAsync(clientFactory, endpoints.Seerr, ApiKeys.ReadSeerr(), cancellationToken),
        };
        await Task.WhenAll(checks);
        logger.LogInformation("All real-stack acceptance checks passed");
    }

    private static Task VerifyBootstrapFilesAsync(CancellationToken cancellationToken)
    {
        foreach (var path in new[]
        {
            "/data/status/bootstrap.json",
            "/data/status/reconciliation.json",
            "/data/traefik/dynamic/services.yml",
            "/data/authelia/config/configuration.yml",
            "/data/homepage/services.yaml",
            "/data/recyclarr/recyclarr.yml",
        })
        {
            Ensure(File.Exists(path), $"Bootstrap file is missing: {path}");
        }
        return Task.CompletedTask;
    }

    private static async Task VerifyIngressAsync(
        IHttpClientFactory clientFactory,
        string ingressUrl,
        string domain,
        CancellationToken cancellationToken)
    {
        using var client = clientFactory.CreateClient("insecure-ingress");
        using var request = new HttpRequestMessage(HttpMethod.Get, ingressUrl);
        request.Headers.Host = $"sonarr.{domain}";
        using var response = await client.SendAsync(request, cancellationToken);
        Ensure(
            response.StatusCode == HttpStatusCode.Unauthorized,
            $"Ingress accepted an unauthenticated request ({(int)response.StatusCode})");
    }

    private static async Task VerifyQBittorrentAsync(
        IHttpClientFactory clientFactory,
        string baseUrl,
        string password,
        CancellationToken cancellationToken)
    {
        using var client = clientFactory.CreateClient("cookies");
        using var login = await Http.SendAsync(
            client,
            HttpMethod.Post,
            baseUrl + "/api/v2/auth/login",
            Http.Form(new Dictionary<string, string>
            {
                ["username"] = "admin",
                ["password"] = password,
            }),
            cancellationToken: cancellationToken);
        var headers = new Dictionary<string, string>
        {
            ["Referer"] = baseUrl + "/",
            ["Origin"] = baseUrl,
        };
        var preferences = await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + "/api/v2/app/preferences",
            headers: headers,
            cancellationToken: cancellationToken);
        Ensure(preferences["proxy_type"]?.GetValue<string>() == "None",
            "qBittorrent has a redundant application proxy");
        var categories = await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + "/api/v2/torrents/categories",
            headers: headers,
            cancellationToken: cancellationToken);
        foreach (var pair in new Dictionary<string, string>
        {
            ["sonarr"] = "/downloads/sonarr",
            ["radarr"] = "/downloads/radarr",
            ["lidarr"] = "/downloads/lidarr",
        })
        {
            Ensure(categories[pair.Key]?["savePath"]?.GetValue<string>() == pair.Value,
                $"qBittorrent {pair.Key} category is not configured");
        }
    }

    private static async Task VerifyArrAsync(
        IHttpClientFactory clientFactory,
        string name,
        string baseUrl,
        string version,
        string key,
        string rootFolder,
        CancellationToken cancellationToken)
    {
        var headers = new Dictionary<string, string> { ["X-Api-Key"] = key };
        using var client = clientFactory.CreateClient();
        var clients = (await Http.JsonAsync(
            client, HttpMethod.Get, $"{baseUrl}/api/{version}/downloadclient",
            headers: headers, cancellationToken: cancellationToken)).AsArray();
        Ensure(clients.Any(item => item?["implementation"]?.GetValue<string>() == "QBittorrent"),
            $"{name} has no qBittorrent download client");
        var roots = (await Http.JsonAsync(
            client, HttpMethod.Get, $"{baseUrl}/api/{version}/rootfolder",
            headers: headers, cancellationToken: cancellationToken)).AsArray();
        Ensure(roots.Any(item => item?["path"]?.GetValue<string>() == rootFolder),
            $"{name} root folder is missing");
    }

    private static async Task VerifyProwlarrAsync(
        IHttpClientFactory clientFactory,
        string baseUrl,
        string key,
        CancellationToken cancellationToken)
    {
        var headers = new Dictionary<string, string> { ["X-Api-Key"] = key };
        using var client = clientFactory.CreateClient();
        var host = await Http.JsonAsync(
            client, HttpMethod.Get, baseUrl + "/api/v1/config/host",
            headers: headers, cancellationToken: cancellationToken);
        Ensure(host["proxyEnabled"]?.GetValue<bool>() is true, "Prowlarr VPN proxy is disabled");
        var apps = (await Http.JsonAsync(
            client, HttpMethod.Get, baseUrl + "/api/v1/applications",
            headers: headers, cancellationToken: cancellationToken)).AsArray();
        foreach (var app in new[] { "Sonarr", "Radarr", "Lidarr" })
        {
            Ensure(apps.Any(item => item?["implementation"]?.GetValue<string>() == app),
                $"Prowlarr {app} application is missing");
        }
    }

    private static async Task VerifyBazarrAsync(
        IHttpClientFactory clientFactory,
        string baseUrl,
        string key,
        CancellationToken cancellationToken)
    {
        using var client = clientFactory.CreateClient();
        var settings = await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + "/api/system/settings",
            headers: new Dictionary<string, string> { ["X-API-KEY"] = key },
            cancellationToken: cancellationToken);
        Ensure(settings["general"]?["use_sonarr"]?.GetValue<bool>() is true,
            "Bazarr Sonarr is disabled");
        Ensure(settings["general"]?["use_radarr"]?.GetValue<bool>() is true,
            "Bazarr Radarr is disabled");
    }

    private static async Task VerifyJellyfinAsync(
        IHttpClientFactory clientFactory,
        string baseUrl,
        CancellationToken cancellationToken)
    {
        using var client = clientFactory.CreateClient();
        var info = await Http.JsonAsync(
            client, HttpMethod.Get, baseUrl + "/System/Info/Public",
            cancellationToken: cancellationToken);
        Ensure(info["StartupWizardCompleted"]?.GetValue<bool>() is true,
            "Jellyfin startup wizard is incomplete");
    }

    private static async Task VerifySeerrAsync(
        IHttpClientFactory clientFactory,
        string baseUrl,
        string key,
        CancellationToken cancellationToken)
    {
        using var client = clientFactory.CreateClient();
        var settings = await Http.JsonAsync(
            client, HttpMethod.Get, baseUrl + "/api/v1/settings/public",
            cancellationToken: cancellationToken);
        Ensure(settings["initialized"]?.GetValue<bool>() is true, "Seerr is not initialized");
        var headers = new Dictionary<string, string> { ["X-Api-Key"] = key };
        var sonarr = (await Http.JsonAsync(
            client, HttpMethod.Get, baseUrl + "/api/v1/settings/sonarr",
            headers: headers, cancellationToken: cancellationToken)).AsArray();
        var radarr = (await Http.JsonAsync(
            client, HttpMethod.Get, baseUrl + "/api/v1/settings/radarr",
            headers: headers, cancellationToken: cancellationToken)).AsArray();
        Ensure(sonarr.Any(item => item?["isDefault"]?.GetValue<bool>() is true),
            "Seerr has no default Sonarr");
        Ensure(radarr.Any(item => item?["isDefault"]?.GetValue<bool>() is true),
            "Seerr has no default Radarr");
    }

    private static void Ensure(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException(message);
        }
    }
}
