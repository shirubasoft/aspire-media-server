using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;

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
    public static async Task RunAsync(
        ControlPlaneOptions options,
        ServiceEndpointOptions endpoints,
        IHttpClientFactory clientFactory,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var results = new List<ReconciliationResult>();
        try
        {
            await Status.WriteReconciliationPendingAsync(cancellationToken);
            var urls = endpoints.ToServiceUrls();
            var sonarrKey = ApiKeys.ReadArr("sonarr");
            var radarrKey = ApiKeys.ReadArr("radarr");
            var lidarrKey = ApiKeys.ReadArr("lidarr");
            var prowlarrKey = ApiKeys.ReadArr("prowlarr");
            var bazarrKey = await ApiKeys.ReadBazarrAsync(cancellationToken);
            var seerrKey = ApiKeys.ReadSeerr();
            var qbitPassword = options.QBittorrentPassword;
            await RequiredStageAsync(
                results,
                [
                    ("qbittorrent", token => new QBittorrentApi(
                        clientFactory.CreateClient("cookies"),
                        urls.QBittorrent,
                        qbitPassword).ReconcileAsync(token)),
                    ("jellyfin", token => new JellyfinApi(
                        clientFactory.CreateClient(),
                        logger,
                        urls.Jellyfin,
                        options.JellyfinAdminUser,
                        options.JellyfinAdminPassword,
                        options.JellyfinServerName,
                        options.JellyfinLanguage)
                        .ReconcileAsync(
                            urls,
                            sonarrKey,
                            radarrKey,
                            bazarrKey,
                            seerrKey,
                            token)),
                ],
                logger,
                cancellationToken);

            var minimumSeeders = options.MinimumSeeders;
            var originalTitle = options.UseOriginalTitle;
            await RequiredStageAsync(
                results,
                [
                    ("sonarr", token => new ArrApi(
                        clientFactory.CreateClient(),
                        "sonarr", urls.Sonarr, "v3", sonarrKey, "/tv", "sonarr")
                        .ReconcileAsync(urls.QBittorrent, qbitPassword, minimumSeeders, originalTitle, token)),
                    ("radarr", token => new ArrApi(
                        clientFactory.CreateClient(),
                        "radarr", urls.Radarr, "v3", radarrKey, "/movies", "radarr")
                        .ReconcileAsync(urls.QBittorrent, qbitPassword, minimumSeeders, originalTitle, token)),
                    ("lidarr", token => new ArrApi(
                        clientFactory.CreateClient(),
                        "lidarr", urls.Lidarr, "v1", lidarrKey, "/music", "lidarr")
                        .ReconcileAsync(urls.QBittorrent, qbitPassword, minimumSeeders, originalTitle, token)),
                ],
                logger,
                cancellationToken);

            var publicIndexerResults = Array.Empty<ReconciliationResult>();
            await RequiredStageAsync(
                results,
                [
                    ("prowlarr", async token =>
                    {
                        var integrations = await new ProwlarrApi(
                            clientFactory.CreateClient(),
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
                        clientFactory.CreateClient(),
                        urls.Bazarr,
                        bazarrKey,
                        options).ReconcileAsync(
                            urls.Sonarr,
                            sonarrKey,
                            urls.Radarr,
                            radarrKey,
                            options.SubtitleLanguages.Split(',', StringSplitOptions.TrimEntries),
                            token)),
                    ("seerr", token => new SeerrApi(
                        clientFactory.CreateClient("cookies"),
                        urls.Seerr,
                        urls.Jellyfin,
                        options.JellyfinAdminUser,
                        options.JellyfinAdminPassword,
                        seerrKey,
                        options.TraefikDomain,
                        options.IngressHttpsPort).ReconcileAsync(
                            urls.Sonarr,
                            sonarrKey,
                            urls.Radarr,
                            radarrKey,
                            token)),
                    ("recyclarr", token => Recyclarr.WriteConfigurationAsync(
                        urls.Sonarr, sonarrKey, urls.Radarr, radarrKey, logger, token)),
                    ("tdarr", token => new TdarrApi(
                        clientFactory.CreateClient(), urls.Tdarr).ReconcileAsync(token)),
                    ("duplicati", token => new DuplicatiApi(
                        clientFactory.CreateClient(),
                        urls.Duplicati,
                        options.DuplicatiWebPassword,
                        options.DuplicatiEncryptionKey).ReconcileAsync(token)),
                ],
                logger,
                cancellationToken);
            results.AddRange(publicIndexerResults);
            results.AddRange(OptionalResults(options, completed: true));
            await AppendNotificationResultAsync(
                results, endpoints, clientFactory, cancellationToken);
            var summary = await Status.WriteReconciliationAsync(results, cancellationToken);
            logger.LogInformation(
                "Reconciliation completed with status {Status}", summary.Status);
        }
        catch (Exception exception)
        {
            if (!results.Any(result => result.Status == "failed"))
            {
                results.Add(new("control-plane", true, "failed", exception.Message));
            }

            results.AddRange(OptionalResults(options, completed: false));
            await AppendNotificationResultAsync(
                results, endpoints, clientFactory, cancellationToken);
            await Status.WriteReconciliationAsync(results, cancellationToken);
            throw;
        }
    }

    private static async Task RequiredStageAsync(
        List<ReconciliationResult> results,
        IReadOnlyList<(string Name, Func<CancellationToken, Task> Operation)> operations,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var stage = await Task.WhenAll(operations.Select(async operation =>
        {
            try
            {
                await operation.Operation(cancellationToken);
                logger.LogInformation(
                    "Integration {Integration} reconciled", operation.Name);
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

    private static IReadOnlyList<ReconciliationResult> OptionalResults(
        ControlPlaneOptions options,
        bool completed)
        => Validation.OptionalCredentialStates(options.ToValidationValues()).Select(provider =>
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
        ServiceEndpointOptions endpoints,
        IHttpClientFactory clientFactory,
        CancellationToken cancellationToken)
    {
        var url = endpoints.Notifier;
        if (url.Length == 0)
        {
            return;
        }

        try
        {
            using var client = clientFactory.CreateClient();
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

}

internal abstract class JsonApi(
    HttpClient client,
    string baseUrl,
    string? apiKey = null)
{
    protected HttpClient Client { get; } = client;
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
