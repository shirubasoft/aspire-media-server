using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Arrspire.ControlPlane;

internal sealed record ServiceUrls(
    string GluetunProxy,
    string Sonarr,
    string Radarr,
    string Lidarr,
    string Prowlarr,
    string Bazarr,
    string Jellyfin,
    string Seerr,
    string QBittorrent,
    string Tdarr,
    string Duplicati);

internal static class Reconciler
{
    public static async Task RunAsync(CancellationToken cancellationToken)
    {
        var results = new List<ReconciliationResult>();
        try
        {
            await Status.WriteReconciliationPendingAsync(cancellationToken);
            var urls = LoadUrls();
            Log.Info("Waiting for the real service APIs");
            await Task.WhenAll(new Dictionary<string, string>
            {
                ["qBittorrent"] = urls.QBittorrent + "/",
                ["Sonarr"] = urls.Sonarr + "/ping",
                ["Radarr"] = urls.Radarr + "/ping",
                ["Lidarr"] = urls.Lidarr + "/ping",
                ["Prowlarr"] = urls.Prowlarr + "/ping",
                ["Bazarr"] = urls.Bazarr + "/",
                ["Jellyfin"] = urls.Jellyfin + "/health",
                ["Seerr"] = urls.Seerr + "/api/v1/status",
                ["Tdarr"] = urls.Tdarr + "/api/v2/status",
                ["Duplicati"] = urls.Duplicati + "/ngclient/",
            }.Select(pair => Http.WaitForAsync(pair.Key, pair.Value, cancellationToken)));

            var sonarrKey = ApiKeys.ReadArr("sonarr");
            var radarrKey = ApiKeys.ReadArr("radarr");
            var lidarrKey = ApiKeys.ReadArr("lidarr");
            var prowlarrKey = ApiKeys.ReadArr("prowlarr");
            var bazarrKey = await ApiKeys.ReadBazarrAsync(cancellationToken);
            var seerrKey = ApiKeys.ReadSeerr();
            var qbitPassword = Env.Required("QBITTORRENT_PASSWORD");
            await RequiredStageAsync(
                results,
                [
                    ("qbittorrent", token => new QBittorrentApi(
                        urls.QBittorrent,
                        qbitPassword).ReconcileAsync(token)),
                    ("jellyfin", token => new JellyfinApi(
                        urls.Jellyfin,
                        Env.Required("JELLYFIN_ADMIN_USER"),
                        Env.Required("JELLYFIN_ADMIN_PASSWORD"),
                        Env.Required("JELLYFIN_SERVER_NAME"),
                        Env.Required("JELLYFIN_LANGUAGE"))
                        .ReconcileAsync(
                            urls,
                            sonarrKey,
                            radarrKey,
                            bazarrKey,
                            seerrKey,
                            token)),
                ],
                cancellationToken);

            var minimumSeeders = Env.Integer("MINIMUM_SEEDERS", 1);
            var originalTitle = Env.Boolean("USE_ORIGINAL_TITLE", false);
            await RequiredStageAsync(
                results,
                [
                    ("sonarr", token => new ArrApi(
                        "sonarr", urls.Sonarr, "v3", sonarrKey, "/tv", "sonarr")
                        .ReconcileAsync(urls.QBittorrent, qbitPassword, minimumSeeders, originalTitle, token)),
                    ("radarr", token => new ArrApi(
                        "radarr", urls.Radarr, "v3", radarrKey, "/movies", "radarr")
                        .ReconcileAsync(urls.QBittorrent, qbitPassword, minimumSeeders, originalTitle, token)),
                    ("lidarr", token => new ArrApi(
                        "lidarr", urls.Lidarr, "v1", lidarrKey, "/music", "lidarr")
                        .ReconcileAsync(urls.QBittorrent, qbitPassword, minimumSeeders, originalTitle, token)),
                ],
                cancellationToken);

            var publicIndexerResults = Array.Empty<ReconciliationResult>();
            await RequiredStageAsync(
                results,
                [
                    ("prowlarr", async token =>
                    {
                        var integrations = await new ProwlarrApi(
                            urls.Prowlarr,
                            prowlarrKey).ReconcileAsync(
                                urls.GluetunProxy,
                                [
                                    new("Sonarr", urls.Sonarr, sonarrKey,
                                        [5000, 5010, 5020, 5030, 5040, 5045, 5050]),
                                    new("Radarr", urls.Radarr, radarrKey,
                                        [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060]),
                                    new("Lidarr", urls.Lidarr, lidarrKey,
                                        [3000, 3010, 3020, 3030, 3040]),
                                ],
                                token);
                        publicIndexerResults = integrations.Select(result =>
                            new ReconciliationResult(
                                $"public-indexer:{result.Name}",
                                false,
                                result.Status,
                                result.Reason)).ToArray();
                    }),
                    ("bazarr", token => new BazarrApi(
                        urls.Bazarr,
                        bazarrKey).ReconcileAsync(
                            urls.Sonarr,
                            sonarrKey,
                            urls.Radarr,
                            radarrKey,
                            Env.Required("SUBTITLE_LANGUAGES").Split(',', StringSplitOptions.TrimEntries),
                            token)),
                    ("seerr", token => new SeerrApi(
                        urls.Seerr,
                        urls.Jellyfin,
                        Env.Required("JELLYFIN_ADMIN_USER"),
                        Env.Required("JELLYFIN_ADMIN_PASSWORD"),
                        seerrKey).ReconcileAsync(
                            urls.Sonarr,
                            sonarrKey,
                            urls.Radarr,
                            radarrKey,
                            token)),
                    ("recyclarr", token => Recyclarr.WriteConfigurationAsync(
                        urls.Sonarr, sonarrKey, urls.Radarr, radarrKey, token)),
                    ("tdarr", token => new TdarrApi(urls.Tdarr).ReconcileAsync(token)),
                    ("duplicati", token => new DuplicatiApi(
                        urls.Duplicati,
                        Env.Required("DUPLICATI_WEB_PASSWORD"),
                        Env.Required("DUPLICATI_ENCRYPTION_KEY")).ReconcileAsync(token)),
                ],
                cancellationToken);
            results.AddRange(publicIndexerResults);
            results.AddRange(OptionalResults(completed: true));
            await AppendNotificationResultAsync(results, cancellationToken);
            var summary = await Status.WriteReconciliationAsync(results, cancellationToken);
            Log.Info("Reconciliation summary", summary);
        }
        catch (Exception exception)
        {
            if (!results.Any(result => result.Status == "failed"))
            {
                results.Add(new("control-plane", true, "failed", exception.Message));
            }

            results.AddRange(OptionalResults(completed: false));
            await AppendNotificationResultAsync(results, cancellationToken);
            await Status.WriteReconciliationAsync(results, cancellationToken);
            throw;
        }
    }

    private static async Task RequiredStageAsync(
        List<ReconciliationResult> results,
        IReadOnlyList<(string Name, Func<CancellationToken, Task> Operation)> operations,
        CancellationToken cancellationToken)
    {
        var stage = await Task.WhenAll(operations.Select(async operation =>
        {
            try
            {
                await operation.Operation(cancellationToken);
                Log.Info("Integration reconciled", new { integration = operation.Name });
                return new ReconciliationResult(operation.Name, true, "ready");
            }
            catch (Exception exception)
            {
                return new ReconciliationResult(
                    operation.Name,
                    true,
                    "failed",
                    $"{operation.Name} reconciliation failed: {exception.Message}");
            }
        }));
        results.AddRange(stage);
        var failures = stage.Where(result => result.Status == "failed").ToArray();
        if (failures.Length > 0)
        {
            throw new InvalidOperationException(
                string.Join("; ", failures.Select(failure => failure.Reason)));
        }
    }

    private static IReadOnlyList<ReconciliationResult> OptionalResults(bool completed)
        => Validation.OptionalCredentialStates().Select(provider =>
            provider.Configured
                ? new ReconciliationResult(
                    $"subtitle-provider:{provider.Name}",
                    false,
                    completed ? "ready" : "failed",
                    completed ? null : "Core reconciliation did not complete")
                : new ReconciliationResult(
                    $"subtitle-provider:{provider.Name}",
                    false,
                    "skipped",
                    provider.Reason)).ToArray();

    private static async Task AppendNotificationResultAsync(
        List<ReconciliationResult> results,
        CancellationToken cancellationToken)
    {
        var url = Env.Optional("NOTIFIER_URL");
        if (url.Length == 0)
        {
            return;
        }

        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            using var response = await client.PostAsJsonAsync(
                url + "/reconciliation",
                new { results },
                JsonDefaults.Compact,
                cancellationToken);
            response.EnsureSuccessStatusCode();
            var delivery = await response.Content.ReadFromJsonAsync<JsonObject>(
                JsonDefaults.Compact,
                cancellationToken);
            if (delivery?["configured"]?.GetValue<bool>() is true)
            {
                results.Add(new("notification:ntfy", false, "ready"));
            }
        }
        catch (Exception exception)
        {
            results.Add(new("notification:ntfy", false, "failed", exception.Message));
        }
    }

    private static ServiceUrls LoadUrls()
        => new(
            Env.Required("GLUETUN_PROXY_URL"),
            Env.Required("SONARR_URL"),
            Env.Required("RADARR_URL"),
            Env.Required("LIDARR_URL"),
            Env.Required("PROWLARR_URL"),
            Env.Required("BAZARR_URL"),
            Env.Required("JELLYFIN_URL"),
            Env.Required("SEERR_URL"),
            Env.Required("QBITTORRENT_URL"),
            Env.Required("TDARR_URL"),
            Env.Required("DUPLICATI_URL"));
}

internal abstract class JsonApi(string baseUrl, string? apiKey = null)
{
    protected readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(30) };
    protected string BaseUrl { get; } = baseUrl.TrimEnd('/');
    protected IReadOnlyDictionary<string, string> Headers { get; } =
        apiKey is null
            ? new Dictionary<string, string>()
            : new Dictionary<string, string> { ["X-Api-Key"] = apiKey };

    protected Task<JsonNode> GetAsync(string path, CancellationToken token)
        => Http.JsonAsync(Client, HttpMethod.Get, BaseUrl + path, headers: Headers, cancellationToken: token);

    protected Task<JsonNode> PostAsync(string path, JsonNode body, CancellationToken token)
        => Http.JsonAsync(Client, HttpMethod.Post, BaseUrl + path, body, Headers, token);

    protected Task<JsonNode> PutAsync(string path, JsonNode body, CancellationToken token)
        => Http.JsonAsync(Client, HttpMethod.Put, BaseUrl + path, body, Headers, token);

    protected async Task SendAsync(
        HttpMethod method,
        string path,
        JsonNode? body,
        CancellationToken token,
        IReadOnlyDictionary<string, string>? headers = null)
    {
        using var content = body is null
            ? null
            : JsonContent.Create(body, options: JsonDefaults.Compact);
        using var response = await Http.SendAsync(
            Client,
            method,
            BaseUrl + path,
            content,
            headers ?? Headers,
            cancellationToken: token);
    }

    protected static JsonObject Clone(JsonNode node)
        => node.DeepClone().AsObject();

    protected static JsonObject? FindBy(
        JsonArray array,
        string property,
        string value)
        => array.OfType<JsonObject>().FirstOrDefault(item =>
            string.Equals(
                item[property]?.GetValue<string>(),
                value,
                StringComparison.OrdinalIgnoreCase));

    protected static void SetFields(JsonObject model, IReadOnlyDictionary<string, JsonNode?> values)
    {
        if (model["fields"] is not JsonArray fields)
        {
            return;
        }

        foreach (var field in fields.OfType<JsonObject>())
        {
            var name = field["name"]?.GetValue<string>();
            if (name is not null && values.TryGetValue(name, out var value) && value is not null)
            {
                field["value"] = value.DeepClone();
            }
        }
    }
}
