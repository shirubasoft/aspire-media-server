using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging;

namespace Arrspire.ControlPlane;

internal sealed class JellyfinApi(
    HttpClient client,
    ILogger logger,
    string baseUrl,
    string username,
    string password,
    string serverName,
    string language)
{
    private string token = "";

    public async Task ReconcileAsync(
        ServiceUrls urls,
        string sonarrKey,
        string radarrKey,
        string bazarrKey,
        string seerrKey,
        CancellationToken cancellationToken)
    {
        var info = await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + "/System/Info/Public",
            cancellationToken: cancellationToken);
        if (info["StartupWizardCompleted"]?.GetValue<bool>() is not true)
        {
            await CompleteStartupAsync(cancellationToken);
        }

        await AuthenticateAsync(cancellationToken);
        await ReconcileServerNameAsync(cancellationToken);
        await ReconcileLibrariesAsync(cancellationToken);
        await ReconcileRepositoriesAsync(cancellationToken);
        await ReconcilePluginConfigurationsAsync(
            urls,
            sonarrKey,
            radarrKey,
            bazarrKey,
            seerrKey,
            cancellationToken);
        await TriggerInitialSubtitleExtractionAsync(cancellationToken);
        await TriggerIntroSkipperAsync(cancellationToken);
    }

    private string Authorization(string? value = null)
    {
        value ??= token;
        const string basis =
            "MediaBrowser Client=\"Arrspire\", Device=\"Reconciler\", "
            + "DeviceId=\"arrspire-control-plane\", Version=\"1.0.0\"";
        return value.Length > 0 ? $"{basis}, Token=\"{value}\"" : basis;
    }

    private IReadOnlyDictionary<string, string> Headers(string? value = null)
        => new Dictionary<string, string>
        {
            ["Authorization"] = Authorization(value),
        };

    private async Task CompleteStartupAsync(CancellationToken cancellationToken)
    {
        await SendAsync(
            HttpMethod.Post,
            "/Startup/Configuration",
            new JsonObject
            {
                ["ServerName"] = serverName,
                ["UICulture"] = language,
                ["MetadataCountryCode"] = language.Split('-').ElementAtOrDefault(1) ?? "BR",
                ["PreferredMetadataLanguage"] = language.Split('-')[0],
            },
            Headers(""),
            cancellationToken);
        await SendAsync(
            HttpMethod.Get,
            "/Startup/User",
            null,
            Headers(""),
            cancellationToken);
        await SendAsync(
            HttpMethod.Post,
            "/Startup/User",
            new JsonObject { ["Name"] = username, ["Password"] = password },
            Headers(""),
            cancellationToken);
        await SendAsync(
            HttpMethod.Post,
            "/Startup/Complete",
            null,
            Headers(""),
            cancellationToken);
    }

    private async Task AuthenticateAsync(CancellationToken cancellationToken)
    {
        var result = await Http.JsonAsync(
            client,
            HttpMethod.Post,
            baseUrl + "/Users/AuthenticateByName",
            new JsonObject { ["Username"] = username, ["Pw"] = password },
            Headers(""),
            cancellationToken);
        token = result["AccessToken"]?.GetValue<string>()
            ?? throw new InvalidOperationException(
                "Jellyfin authentication returned no access token");
    }

    private async Task ReconcileServerNameAsync(CancellationToken cancellationToken)
    {
        var config = (await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + "/System/Configuration",
            headers: Headers(),
            cancellationToken: cancellationToken)).AsObject();
        if (config["ServerName"]?.GetValue<string>() == serverName)
        {
            return;
        }

        config["ServerName"] = serverName;
        await SendAsync(
            HttpMethod.Post,
            "/System/Configuration",
            config,
            Headers(),
            cancellationToken);
    }

    private async Task ReconcileLibrariesAsync(CancellationToken cancellationToken)
    {
        var existing = (await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + "/Library/VirtualFolders",
            headers: Headers(),
            cancellationToken: cancellationToken)).AsArray();
        foreach (var library in new[]
        {
            (Name: "Movies", Collection: "movies", Path: "/media/movies"),
            (Name: "TV Shows", Collection: "tvshows", Path: "/media/tv"),
            (Name: "Music", Collection: "music", Path: "/media/music"),
        })
        {
            if (existing.Any(folder =>
                folder?["Name"]?.GetValue<string>() == library.Name
                || folder?["CollectionType"]?.GetValue<string>() == library.Collection))
            {
                continue;
            }

            var query = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["name"] = library.Name,
                ["collectionType"] = library.Collection,
                ["paths"] = library.Path,
                ["refreshLibrary"] = "false",
            });
            var queryString = await query.ReadAsStringAsync(cancellationToken);
            await SendAsync(
                HttpMethod.Post,
                "/Library/VirtualFolders?" + queryString,
                null,
                Headers(),
                cancellationToken);
        }
    }

    private async Task ReconcileRepositoriesAsync(CancellationToken cancellationToken)
    {
        var repositories = (await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + "/Repositories",
            headers: Headers(),
            cancellationToken: cancellationToken)).AsArray();
        var desired = new Dictionary<string, string>
        {
            ["Jellyfin Enhanced"] =
                "https://raw.githubusercontent.com/n00bcodr/jellyfin-plugins/main/10.11/manifest.json",
            ["File Transformation"] =
                "https://www.iamparadox.dev/jellyfin/plugins/manifest.json",
            ["Intro Skipper"] = "https://intro-skipper.org/manifest.json",
            ["Jellyfin Stable"] = "https://repo.jellyfin.org/files/plugin/manifest.json",
            ["Bazarr"] =
                "https://raw.githubusercontent.com/enoch85/bazarr-jellyfin/main/manifest.json",
        };
        var changed = false;
        foreach (var repository in desired)
        {
            if (repositories.Any(existing =>
                existing?["Url"]?.GetValue<string>() == repository.Value))
            {
                continue;
            }

            repositories.Add(new JsonObject
            {
                ["Name"] = repository.Key,
                ["Url"] = repository.Value,
                ["Enabled"] = true,
            });
            changed = true;
        }

        if (changed)
        {
            await SendAsync(
                HttpMethod.Post,
                "/Repositories",
                repositories,
                Headers(),
                cancellationToken);
        }
    }

    private async Task ReconcilePluginConfigurationsAsync(
        ServiceUrls urls,
        string sonarrKey,
        string radarrKey,
        string bazarrKey,
        string seerrKey,
        CancellationToken cancellationToken)
    {
        var plugins = (await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + "/Plugins",
            headers: Headers(),
            cancellationToken: cancellationToken)).AsArray();
        await ReconcilePluginAsync(
            plugins,
            plugin => plugin.Equals("Bazarr", StringComparison.OrdinalIgnoreCase),
            new JsonObject
            {
                ["BazarrUrl"] = urls.Bazarr.TrimEnd('/'),
                ["ApiKey"] = bazarrKey,
                ["EnableMovies"] = true,
                ["EnableEpisodes"] = true,
            },
            cancellationToken);
        await ReconcilePluginAsync(
            plugins,
            plugin => plugin.Contains("enhanced", StringComparison.OrdinalIgnoreCase),
            new JsonObject
            {
                ["JellyseerrEnabled"] = true,
                ["JellyseerrUrls"] = urls.Seerr.TrimEnd('/'),
                ["JellyseerrApiKey"] = seerrKey,
                ["JellyseerrShowRecommended"] = true,
                ["JellyseerrShowSimilar"] = true,
                ["JellyseerrExcludeLibraryItems"] = true,
                ["ArrLinksEnabled"] = true,
                ["SonarrUrl"] = urls.Sonarr.TrimEnd('/'),
                ["RadarrUrl"] = urls.Radarr.TrimEnd('/'),
                ["BazarrUrl"] = urls.Bazarr.TrimEnd('/'),
                ["ArrTagsSyncEnabled"] = true,
                ["SonarrApiKey"] = sonarrKey,
                ["RadarrApiKey"] = radarrKey,
                ["QualityTagsEnabled"] = true,
                ["LanguageTagsEnabled"] = true,
                ["ShowAudioLanguages"] = true,
                ["RandomButtonEnabled"] = true,
                ["PauseScreenEnabled"] = true,
                ["BookmarksEnabled"] = true,
            },
            cancellationToken);
        await ReconcilePluginAsync(
            plugins,
            plugin => plugin.Equals("Subtitle Extract", StringComparison.OrdinalIgnoreCase),
            SubtitleExtractDefaults(),
            cancellationToken);
    }

    private async Task ReconcilePluginAsync(
        JsonArray plugins,
        Func<string, bool> matches,
        JsonObject desired,
        CancellationToken cancellationToken)
    {
        var plugin = plugins.OfType<JsonObject>().FirstOrDefault(candidate =>
            candidate["Name"]?.GetValue<string>() is { } name && matches(name));
        if (plugin?["Id"]?.GetValue<string>() is not { Length: > 0 } id)
        {
            logger.LogWarning(
                "Jellyfin plugin is not loaded; configuration deferred");
            return;
        }

        var path = $"/Plugins/{id}/Configuration";
        var current = (await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + path,
            headers: Headers(),
            cancellationToken: cancellationToken)).AsObject();
        var changed = false;
        foreach (var setting in desired)
        {
            if (!JsonNode.DeepEquals(current[setting.Key], setting.Value))
            {
                current[setting.Key] = setting.Value?.DeepClone();
                changed = true;
            }
        }

        if (changed)
        {
            await SendAsync(
                HttpMethod.Post,
                path,
                current,
                Headers(),
                cancellationToken);
        }
    }

    private async Task TriggerInitialSubtitleExtractionAsync(
        CancellationToken cancellationToken)
    {
        var tasks = (await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + "/ScheduledTasks",
            headers: Headers(),
            cancellationToken: cancellationToken)).AsArray();
        foreach (var id in InitialSubtitleExtractionTaskIds(tasks))
        {
            await SendAsync(
                HttpMethod.Post,
                $"/ScheduledTasks/Running/{id}",
                null,
                Headers(),
                cancellationToken);
        }
    }

    internal static IReadOnlyList<string> InitialSubtitleExtractionTaskIds(JsonArray tasks)
    {
        string[] desiredKeys =
        {
            "ExtractAttachments",
            "ExtractSubtitles",
        };
        return desiredKeys.Select(key => tasks.OfType<JsonObject>()
                .FirstOrDefault(task =>
                    string.Equals(
                        task["Key"]?.GetValue<string>(),
                        key,
                        StringComparison.OrdinalIgnoreCase)
                    && string.Equals(
                        task["State"]?.GetValue<string>(),
                        "Idle",
                        StringComparison.OrdinalIgnoreCase)
                    && !string.Equals(
                        task["LastExecutionResult"]?["Status"]?.GetValue<string>(),
                        "Completed",
                        StringComparison.OrdinalIgnoreCase))?["Id"]?.GetValue<string>())
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Cast<string>()
            .ToArray();
    }

    internal static JsonObject SubtitleExtractDefaults()
        => new()
        {
            ["ExtractionDuringLibraryScan"] = true,
            ["IncludeTextSubtitles"] = true,
            ["IncludeGraphicalSubtitles"] = true,
        };

    private async Task TriggerIntroSkipperAsync(CancellationToken cancellationToken)
    {
        var tasks = (await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + "/ScheduledTasks",
            headers: Headers(),
            cancellationToken: cancellationToken)).AsArray();
        var task = tasks.OfType<JsonObject>().FirstOrDefault(candidate =>
        {
            var text = $"{candidate["Name"]} {candidate["Key"]}".ToLowerInvariant();
            return text.Contains("intro skipper", StringComparison.Ordinal)
                || text.Contains("introskipper", StringComparison.Ordinal)
                || text.Contains("detect introduction", StringComparison.Ordinal)
                || text.Contains("analyze episodes", StringComparison.Ordinal);
        });
        if (task?["Id"]?.GetValue<string>() is not { Length: > 0 } id
            || task["State"]?.GetValue<string>() == "Running")
        {
            return;
        }

        await SendAsync(
            HttpMethod.Post,
            $"/ScheduledTasks/Running/{id}",
            null,
            Headers(),
            cancellationToken);
    }

    private async Task SendAsync(
        HttpMethod method,
        string path,
        JsonNode? body,
        IReadOnlyDictionary<string, string> headers,
        CancellationToken cancellationToken)
    {
        using var content = body is null ? null : JsonContent.Create(body);
        using var response = await Http.SendAsync(
            client,
            method,
            baseUrl + path,
            content,
            headers,
            cancellationToken: cancellationToken);
    }
}
