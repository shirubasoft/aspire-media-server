using System.Net;
using System.Net.Security;
using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace Arrspire.ControlPlane;

internal static class Acceptance
{
    public static async Task VerifyAsync(CancellationToken cancellationToken)
    {
        Log.Info("Starting real-stack acceptance checks");
        var checks = new List<Task>
        {
            VerifyBootstrapFilesAsync(cancellationToken),
            VerifyIngressAsync(cancellationToken),
            VerifyQBittorrentAsync(cancellationToken),
            VerifyArrAsync("sonarr", "v3", ApiKeys.ReadArr("sonarr"), "/tv", cancellationToken),
            VerifyArrAsync("radarr", "v3", ApiKeys.ReadArr("radarr"), "/movies", cancellationToken),
            VerifyArrAsync("lidarr", "v1", ApiKeys.ReadArr("lidarr"), "/music", cancellationToken),
            VerifyProwlarrAsync(ApiKeys.ReadArr("prowlarr"), cancellationToken),
            VerifyBazarrAsync(await ApiKeys.ReadBazarrAsync(cancellationToken), cancellationToken),
            VerifyJellyfinAsync(cancellationToken),
            VerifySeerrAsync(ApiKeys.ReadSeerr(), cancellationToken),
        };
        await Task.WhenAll(checks);
        Log.Info("All real-stack acceptance checks passed");
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

    private static async Task VerifyIngressAsync(CancellationToken cancellationToken)
    {
        using var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback = (_, _, _, _) => true,
            AllowAutoRedirect = false,
        };
        using var client = new HttpClient(handler);
        using var request = new HttpRequestMessage(HttpMethod.Get, Env.Required("INGRESS_URL"));
        request.Headers.Host = $"sonarr.{Env.Required("TRAEFIK_DOMAIN")}";
        using var response = await client.SendAsync(request, cancellationToken);
        Ensure(
            response.StatusCode == HttpStatusCode.Unauthorized,
            $"Ingress accepted an unauthenticated request ({(int)response.StatusCode})");
    }

    private static async Task VerifyQBittorrentAsync(CancellationToken cancellationToken)
    {
        var baseUrl = Env.Required("QBITTORRENT_URL");
        using var handler = new HttpClientHandler
        {
            UseCookies = true,
            CookieContainer = new CookieContainer(),
        };
        using var client = new HttpClient(handler);
        using var login = await Http.SendAsync(
            client,
            HttpMethod.Post,
            baseUrl + "/api/v2/auth/login",
            Http.Form(new Dictionary<string, string>
            {
                ["username"] = "admin",
                ["password"] = Env.Required("QBITTORRENT_PASSWORD"),
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
        string name,
        string version,
        string key,
        string rootFolder,
        CancellationToken cancellationToken)
    {
        var baseUrl = Env.Required(name.ToUpperInvariant() + "_URL");
        var headers = new Dictionary<string, string> { ["X-Api-Key"] = key };
        using var client = new HttpClient();
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
        string key,
        CancellationToken cancellationToken)
    {
        var baseUrl = Env.Required("PROWLARR_URL");
        var headers = new Dictionary<string, string> { ["X-Api-Key"] = key };
        using var client = new HttpClient();
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
        string key,
        CancellationToken cancellationToken)
    {
        using var client = new HttpClient();
        var settings = await Http.JsonAsync(
            client,
            HttpMethod.Get,
            Env.Required("BAZARR_URL") + "/api/system/settings",
            headers: new Dictionary<string, string> { ["X-API-KEY"] = key },
            cancellationToken: cancellationToken);
        Ensure(settings["general"]?["use_sonarr"]?.GetValue<bool>() is true,
            "Bazarr Sonarr is disabled");
        Ensure(settings["general"]?["use_radarr"]?.GetValue<bool>() is true,
            "Bazarr Radarr is disabled");
    }

    private static async Task VerifyJellyfinAsync(CancellationToken cancellationToken)
    {
        var baseUrl = Env.Required("JELLYFIN_URL");
        using var client = new HttpClient();
        var info = await Http.JsonAsync(
            client, HttpMethod.Get, baseUrl + "/System/Info/Public",
            cancellationToken: cancellationToken);
        Ensure(info["StartupWizardCompleted"]?.GetValue<bool>() is true,
            "Jellyfin startup wizard is incomplete");
    }

    private static async Task VerifySeerrAsync(
        string key,
        CancellationToken cancellationToken)
    {
        var baseUrl = Env.Required("SEERR_URL");
        using var client = new HttpClient();
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
