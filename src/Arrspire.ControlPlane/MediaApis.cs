using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Arrspire.ControlPlane;

internal sealed class QBittorrentApi(
    HttpClient client,
    string baseUrl,
    string password)
{
    public async Task ReconcileAsync(CancellationToken token)
    {
        using (var response = await Http.SendAsync(
            client,
            HttpMethod.Post,
            baseUrl + "/api/v2/auth/login",
            Http.Form(new Dictionary<string, string>
            {
                ["username"] = "admin",
                ["password"] = password,
            }),
            expected: [HttpStatusCode.OK, HttpStatusCode.NoContent],
            cancellationToken: token))
        {
            if (response.StatusCode == HttpStatusCode.OK
                && (await response.Content.ReadAsStringAsync(token)).Trim() != "Ok.")
            {
                throw new InvalidOperationException("qBittorrent rejected authentication");
            }
        }

        var headers = new Dictionary<string, string>
        {
            ["Referer"] = baseUrl + "/",
            ["Origin"] = baseUrl,
        };
        var current = await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + "/api/v2/app/preferences",
            headers: headers,
            cancellationToken: token).ConfigureAwait(false);
        var desired = JsonSerializer.SerializeToNode(new Dictionary<string, object?>
        {
            ["max_connec"] = 500,
            ["max_connec_per_torrent"] = 100,
            ["max_uploads"] = 50,
            ["max_uploads_per_torrent"] = 10,
            ["max_ratio_enabled"] = false,
            ["max_seeding_time_enabled"] = false,
            ["max_ratio_act"] = 0,
            ["dht"] = true,
            ["pex"] = true,
            ["lsd"] = false,
            ["encryption"] = 1,
            ["current_network_interface"] = "tun0",
            ["upnp"] = false,
            ["max_active_downloads"] = 5,
            ["max_active_uploads"] = 10,
            ["max_active_torrents"] = 15,
            ["dont_count_slow_torrents"] = true,
            ["slow_torrent_dl_rate_threshold"] = 10,
            ["slow_torrent_ul_rate_threshold"] = 10,
            ["auto_tmm_enabled"] = true,
            ["preallocate_all"] = false,
            ["incomplete_files_ext"] = false,
            ["anonymous_mode"] = false,
            ["add_trackers_enabled"] = false,
            ["queueing_enabled"] = true,
            ["save_path"] = "/downloads",
            ["temp_path_enabled"] = true,
            ["temp_path"] = "/downloads/incomplete",
            ["proxy_type"] = "None",
            ["proxy_auth_enabled"] = false,
            ["proxy_peer_connections"] = false,
            ["proxy_hostname_lookup"] = false,
            ["proxy_bittorrent"] = false,
            ["proxy_misc"] = false,
            ["proxy_rss"] = false,
            ["bypass_local_auth"] = true,
        })!.AsObject();
        var changes = new JsonObject();
        foreach (var setting in desired)
        {
            if (!JsonNode.DeepEquals(current[setting.Key], setting.Value))
            {
                changes[setting.Key] = setting.Value?.DeepClone();
            }
        }

        if (changes.Count > 0)
        {
            using var response = await Http.SendAsync(
                client,
                HttpMethod.Post,
                baseUrl + "/api/v2/app/setPreferences",
                Http.Form(new Dictionary<string, string>
                {
                    ["json"] = changes.ToJsonString(),
                }),
                headers,
                cancellationToken: token);
        }

        var categories = (await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + "/api/v2/torrents/categories",
            headers: headers,
            cancellationToken: token)).AsObject();
        foreach (var (name, path) in new Dictionary<string, string>
        {
            ["sonarr"] = "/downloads/sonarr",
            ["radarr"] = "/downloads/radarr",
            ["lidarr"] = "/downloads/lidarr",
        })
        {
            if (categories[name]?["savePath"]?.GetValue<string>() == path)
            {
                continue;
            }

            var endpoint = categories[name] is null ? "createCategory" : "editCategory";
            using var response = await Http.SendAsync(
                client,
                HttpMethod.Post,
                $"{baseUrl}/api/v2/torrents/{endpoint}",
                Http.Form(new Dictionary<string, string>
                {
                    ["category"] = name,
                    ["savePath"] = path,
                }),
                headers,
                cancellationToken: token);
        }
    }
}

internal sealed class ArrApi(
    HttpClient client,
    string name,
    string baseUrl,
    string version,
    string apiKey,
    string rootFolder,
    string category)
    : JsonApi(client, $"{baseUrl.TrimEnd('/')}/api/{version}", apiKey)
{
    public async Task ReconcileAsync(
        string qbittorrentUrl,
        string qbittorrentPassword,
        int minimumSeeders,
        bool useOriginalTitle,
        CancellationToken token)
    {
        await ReconcileDownloadClientAsync(qbittorrentUrl, qbittorrentPassword, token);
        await ReconcileRootFolderAsync(token);
        await ReconcileQualityProfileAsync(token);
        await ReconcileMinimumSeedersAsync(minimumSeeders, token);
        if (name != "lidarr")
        {
            await ReconcileMediaManagementAsync(token);
            await ReconcileNamingAsync(useOriginalTitle, token);
        }
    }

    private async Task ReconcileDownloadClientAsync(
        string url,
        string password,
        CancellationToken token)
    {
        var existing = (await GetAsync("/downloadclient", token)).AsArray();
        var current = existing.OfType<JsonObject>().FirstOrDefault(client =>
            client["implementation"]?.GetValue<string>() == "QBittorrent");
        var schemas = (await GetAsync("/downloadclient/schema", token)).AsArray();
        var model = Clone(current
            ?? schemas.OfType<JsonObject>().FirstOrDefault(schema =>
                schema["implementation"]?.GetValue<string>() == "QBittorrent")
            ?? throw new InvalidOperationException($"{name} has no qBittorrent schema"));
        var endpoint = new Uri(url);
        model["enable"] = true;
        model["name"] = "qBittorrent";
        SetFields(model, new Dictionary<string, JsonNode?>
        {
            ["host"] = endpoint.Host,
            ["port"] = endpoint.IsDefaultPort ? 8080 : endpoint.Port,
            ["username"] = "admin",
            ["password"] = password,
            ["tvCategory"] = category,
            ["movieCategory"] = category,
            ["musicCategory"] = category,
            ["category"] = category,
        });
        if (current?["id"] is JsonNode id)
        {
            _ = await PutAsync($"/downloadclient/{id}", model, token);
        }
        else
        {
            _ = await PostAsync("/downloadclient", model, token);
        }
    }

    private async Task ReconcileRootFolderAsync(CancellationToken token)
    {
        var folders = (await GetAsync("/rootfolder", token)).AsArray();
        if (folders.Any(folder => folder?["path"]?.GetValue<string>() == rootFolder))
        {
            return;
        }

        var payload = new JsonObject { ["path"] = rootFolder };
        if (name == "lidarr")
        {
            var qualities = (await GetAsync("/qualityprofile", token)).AsArray();
            var metadata = (await GetAsync("/metadataprofile", token)).AsArray();
            payload["name"] = "Music";
            payload["defaultQualityProfileId"] = qualities.FirstOrDefault()?["id"]?.DeepClone();
            payload["defaultMetadataProfileId"] = metadata.FirstOrDefault()?["id"]?.DeepClone();
        }

        _ = await PostAsync("/rootfolder", payload, token);
    }

    private async Task ReconcileQualityProfileAsync(CancellationToken token)
    {
        var profiles = (await GetAsync("/qualityprofile", token)).AsArray();
        var profile = FindBy(profiles, "name", "Any")
            ?? profiles.OfType<JsonObject>().FirstOrDefault()
            ?? throw new InvalidOperationException($"{name} has no quality profile");
        var changed = false;
        changed |= Set(profile, "upgradeAllowed", true);
        if (name != "lidarr")
        {
            changed |= Set(profile, "cutoff", 7);
            if (profile["language"]?["id"]?.GetValue<int>() != -2)
            {
                profile["language"] = new JsonObject { ["id"] = -2, ["name"] = "Original" };
                changed = true;
            }
        }

        if (changed)
        {
            _ = await PutAsync($"/qualityprofile/{profile["id"]}", profile, token);
        }
    }

    private async Task ReconcileMinimumSeedersAsync(int minimum, CancellationToken token)
    {
        var indexers = (await GetAsync("/indexer", token)).AsArray();
        foreach (var indexer in indexers.OfType<JsonObject>())
        {
            var changed = false;
            foreach (var field in (indexer["fields"] as JsonArray)?.OfType<JsonObject>()
                ?? [])
            {
                if (field["name"]?.GetValue<string>()
                        is "minimumSeeders" or "seedCriteria.seeders"
                    && field["value"]?.GetValue<int>() != minimum)
                {
                    field["value"] = minimum;
                    changed = true;
                }
            }

            if ((indexer["minimumSeeders"]?.GetValue<int>() ?? 0) < minimum)
            {
                indexer["minimumSeeders"] = minimum;
                changed = true;
            }

            if (changed && indexer["id"] is not null)
            {
                _ = await PutAsync($"/indexer/{indexer["id"]}", indexer, token);
            }
        }
    }

    private async Task ReconcileMediaManagementAsync(CancellationToken token)
    {
        var config = (await GetAsync("/config/mediamanagement", token)).AsObject();
        var desired = new Dictionary<string, JsonNode?>
        {
            ["autoRenameFolders"] = true,
            ["createEmptySeriesFolders"] = false,
            ["deleteEmptyFolders"] = true,
            ["copyUsingHardlinks"] = true,
            ["importExtraFiles"] = true,
            ["extraFileExtensions"] = "srt,nfo",
            ["propersAndRepacks"] = "doNotPrefer",
        };
        if (desired.Aggregate(false, (changed, pair) => Set(config, pair.Key, pair.Value) | changed))
        {
            _ = await PutAsync("/config/mediamanagement", config, token);
        }
    }

    private async Task ReconcileNamingAsync(bool original, CancellationToken token)
    {
        var config = (await GetAsync("/config/naming", token)).AsObject();
        var desired = name == "sonarr"
            ? new Dictionary<string, JsonNode?>
            {
                ["renameEpisodes"] = true,
                ["replaceIllegalCharacters"] = true,
                ["standardEpisodeFormat"] = original
                    ? "{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}"
                    : "{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {Quality Full}",
            }
            : new Dictionary<string, JsonNode?>
            {
                ["renameMovies"] = true,
                ["replaceIllegalCharacters"] = true,
                ["standardMovieFormat"] = original
                    ? "{Movie Title} ({Release Year}) {Quality Full}"
                    : "{Movie CleanTitle} ({Release Year}) {Quality Full}",
            };
        if (desired.Aggregate(false, (changed, pair) => Set(config, pair.Key, pair.Value) | changed))
        {
            _ = await PutAsync("/config/naming", config, token);
        }
    }

    private static bool Set(JsonObject target, string name, JsonNode? value)
    {
        if (JsonNode.DeepEquals(target[name], value))
        {
            return false;
        }

        target[name] = value?.DeepClone();
        return true;
    }
}

internal sealed record ProwlarrApplication(
    string Name,
    string Url,
    string ApiKey,
    IReadOnlyList<int> Categories);

internal sealed record OptionalIntegration(string Name, string Status, string? Reason = null);

internal sealed class ProwlarrApi(HttpClient client, string baseUrl, string apiKey)
    : JsonApi(client, baseUrl.TrimEnd('/') + "/api/v1", apiKey)
{
    public async Task<IReadOnlyList<OptionalIntegration>> ReconcileAsync(
        string proxyUrl,
        IReadOnlyList<ProwlarrApplication> applications,
        CancellationToken token)
    {
        var proxy = new Uri(proxyUrl);
        var host = (await GetAsync("/config/host", token)).AsObject();
        var desiredHost = new Dictionary<string, JsonNode?>
        {
            ["proxyEnabled"] = true,
            ["proxyType"] = "http",
            ["proxyHostname"] = proxy.Host,
            ["proxyPort"] = proxy.IsDefaultPort ? 8888 : proxy.Port,
            ["proxyUsername"] = "",
            ["proxyPassword"] = "",
            ["proxyBypassFilter"] = "",
            ["proxyBypassLocalAddresses"] = true,
        };
        if (Apply(host, desiredHost))
        {
            _ = await PutAsync("/config/host", host, token);
        }

        var existingApplications = (await GetAsync("/applications", token)).AsArray();
        var schemas = (await GetAsync("/applications/schema", token)).AsArray();
        foreach (var application in applications)
        {
            var current = FindBy(existingApplications, "implementation", application.Name);
            var model = Clone(current
                ?? FindBy(schemas, "implementation", application.Name)
                ?? throw new InvalidOperationException(
                    $"Prowlarr has no application schema for {application.Name}"));
            model["name"] = application.Name;
            model["syncLevel"] = "fullSync";
            SetFields(model, new Dictionary<string, JsonNode?>
            {
                ["prowlarrUrl"] = BaseUrl.Replace("/api/v1", "", StringComparison.Ordinal),
                ["baseUrl"] = application.Url,
                ["apiKey"] = application.ApiKey,
                ["syncCategories"] = JsonSerializer.SerializeToNode(application.Categories),
                ["animeSyncCategories"] = application.Name == "Sonarr"
                    ? JsonSerializer.SerializeToNode(new[] { 5070 })
                    : null,
                ["syncAnimeStandardFormatSearch"] =
                    application.Name == "Sonarr" ? false : null,
            });
            if (current?["id"] is not null)
            {
                _ = await PutAsync($"/applications/{current["id"]}", model, token);
            }
            else
            {
                _ = await PostAsync("/applications", model, token);
            }
        }

        var existingIndexers = (await GetAsync("/indexer", token)).AsArray();
        var retired = FindBy(existingIndexers, "name", "LimeTorrents");
        if (retired?["id"] is not null && retired["enable"]?.GetValue<bool>() != false)
        {
            retired["enable"] = false;
            retired["enableAutomaticSearch"] = false;
            retired["enableInteractiveSearch"] = false;
            _ = await PutAsync($"/indexer/{retired["id"]}?forceSave=true", retired, token);
        }

        var desiredIndexers = new Dictionary<string, int>
        {
            ["Nyaa.si"] = 5,
            ["EZTV"] = 25,
            ["Knaben"] = 20,
            ["YTS"] = 25,
        };
        JsonArray indexerSchemas;
        try
        {
            indexerSchemas = (await GetAsync("/indexer/schema", token)).AsArray();
        }
        catch (Exception exception)
        {
            var reason = Status.CompactReason(exception.Message);
            return desiredIndexers.Keys
                .Select(name => new OptionalIntegration(name, "failed", reason))
                .ToArray();
        }

        var results = new List<OptionalIntegration>();
        foreach (var (name, priority) in desiredIndexers)
        {
            var current = FindBy(existingIndexers, "name", name);
            var template = current ?? FindBy(indexerSchemas, "name", name);
            if (template is null)
            {
                results.Add(new(name, "skipped", "Prowlarr indexer schema is unavailable"));
                continue;
            }

            var model = Clone(template);
            model["enable"] = true;
            model["appProfileId"] = 1;
            model["priority"] = priority;
            try
            {
                if (current?["id"] is not null)
                {
                    _ = await PutAsync($"/indexer/{current["id"]}", model, token);
                }
                else
                {
                    _ = await PostAsync("/indexer", model, token);
                }
                results.Add(new(name, "ready"));
            }
            catch (Exception exception)
            {
                results.Add(new(name, "failed", Status.CompactReason(exception.Message)));
            }
        }

        return results;
    }

    private static bool Apply(JsonObject target, IReadOnlyDictionary<string, JsonNode?> desired)
    {
        var changed = false;
        foreach (var pair in desired)
        {
            if (!JsonNode.DeepEquals(target[pair.Key], pair.Value))
            {
                target[pair.Key] = pair.Value?.DeepClone();
                changed = true;
            }
        }
        return changed;
    }
}
