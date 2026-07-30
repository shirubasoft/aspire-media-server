using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Arrspire.ControlPlane;

internal sealed class BazarrApi(string baseUrl, string apiKey)
{
    private readonly HttpClient client = new() { Timeout = TimeSpan.FromSeconds(30) };
    private readonly IReadOnlyDictionary<string, string> headers =
        new Dictionary<string, string> { ["X-API-KEY"] = apiKey };

    public async Task ReconcileAsync(
        string sonarrUrl,
        string sonarrKey,
        string radarrUrl,
        string radarrKey,
        IReadOnlyList<string> languages,
        CancellationToken token)
    {
        await ReconcileArrAsync("sonarr", sonarrUrl, sonarrKey, token);
        await ReconcileArrAsync("radarr", radarrUrl, radarrKey, token);
        var mapped = languages.Select(LanguageCode).ToArray();
        var profileId = await ReconcileLanguageProfileAsync(mapped, token);
        await PostSettingsAsync(new Dictionary<string, string>
        {
            ["settings-general-serie_default_enabled"] = "true",
            ["settings-general-serie_default_language"] = JsonSerializer.Serialize(mapped),
            ["settings-general-serie_default_profile"] = profileId.ToString(),
            ["settings-general-movie_default_enabled"] = "true",
            ["settings-general-movie_default_language"] = JsonSerializer.Serialize(mapped),
            ["settings-general-movie_default_profile"] = profileId.ToString(),
            ["settings-sonarr-minimum_score"] = "90",
            ["settings-radarr-minimum_score"] = "80",
            ["settings-subsync-use_subsync"] = "true",
            ["settings-subsync-use_subsync_threshold"] = "true",
            ["settings-subsync-subsync_threshold"] = "96",
            ["settings-subsync-use_subsync_movie_threshold"] = "true",
            ["settings-subsync-subsync_movie_threshold"] = "86",
            ["settings-general-serie_default_hi"] = "2",
            ["settings-general-movie_default_hi"] = "2",
        }, token);
        await ReconcileProvidersAsync(token);
    }

    internal static string LanguageCode(string language)
        => language.Equals("pt-BR", StringComparison.OrdinalIgnoreCase) ? "pb" : language;

    private async Task ReconcileArrAsync(
        string name,
        string url,
        string key,
        CancellationToken token)
    {
        var endpoint = new Uri(url);
        await PostSettingsAsync(new Dictionary<string, string>
        {
            [$"settings-general-use_{name}"] = "true",
            [$"settings-{name}-ip"] = endpoint.Host,
            [$"settings-{name}-port"] = endpoint.IsDefaultPort
                ? name == "sonarr" ? "8989" : "7878"
                : endpoint.Port.ToString(),
            [$"settings-{name}-base_url"] = "/",
            [$"settings-{name}-ssl"] = (endpoint.Scheme == "https").ToString().ToLowerInvariant(),
            [$"settings-{name}-apikey"] = key,
            [$"settings-{name}-only_monitored"] = "false",
            [$"settings-{name}-{(name == "sonarr" ? "series" : "movies")}_sync"] = "60",
            [$"settings-{name}-full_update"] = "Daily",
            [$"settings-{name}-full_update_day"] = "6",
            [$"settings-{name}-full_update_hour"] = "4",
        }, token);
    }

    private async Task<int> ReconcileLanguageProfileAsync(
        IReadOnlyList<string> languages,
        CancellationToken token)
    {
        var profiles = (await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + "/api/system/languages/profiles",
            headers: headers,
            cancellationToken: token)).AsArray();
        var ordered = languages.Order(StringComparer.Ordinal).ToArray();
        foreach (var profile in profiles.OfType<JsonObject>())
        {
            var current = (profile["items"] as JsonArray)?.OfType<JsonObject>()
                .Select(item => item["language"]?.GetValue<string>())
                .Where(value => value is not null)
                .Cast<string>()
                .Order(StringComparer.Ordinal)
                .ToArray() ?? [];
            if (current.SequenceEqual(ordered)
                && profile["profileId"]?.GetValue<int>() is int existing)
            {
                return existing;
            }
        }

        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(string.Join(',', ordered)));
        var profileId = (int)(System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(digest) % 900_000) + 100_000;
        var newProfile = new JsonObject
        {
            ["profileId"] = profileId,
            ["name"] = string.Join(" + ", languages),
            ["items"] = new JsonArray(languages.Select((language, index) =>
                (JsonNode)new JsonObject
                {
                    ["id"] = index + 1,
                    ["language"] = language,
                    ["audio_exclude"] = "False",
                    ["hi"] = "False",
                    ["forced"] = "False",
                }).ToArray()),
            ["cutoff"] = null,
            ["mustContain"] = new JsonArray(),
            ["mustNotContain"] = new JsonArray(),
            ["originalFormat"] = false,
        };
        profiles.Add(newProfile);
        await PostSettingsAsync(new Dictionary<string, string>
        {
            ["languages-profiles"] = profiles.ToJsonString(),
        }, token);
        return profileId;
    }

    private async Task ReconcileProvidersAsync(CancellationToken token)
    {
        var values = new List<KeyValuePair<string, string>>();
        void Add(string name, IReadOnlyDictionary<string, string>? settings = null)
        {
            values.Add(new("settings-general-enabled_providers", name));
            foreach (var setting in settings ?? new Dictionary<string, string>())
            {
                values.Add(new($"settings-{name}-{setting.Key}", setting.Value));
            }
        }

        Add("podnapisi");
        AddIfConfigured("opensubtitlescom", "OPENSUBTITLESCOM_USER", "OPENSUBTITLESCOM_PASSWORD",
            (user, password) => new Dictionary<string, string>
            {
                ["username"] = user,
                ["password"] = password,
                ["use_hash"] = "true",
                ["include_ai_translated"] = "false",
            });
        AddIfConfigured("opensubtitles", "OPENSUBTITLESORG_USER", "OPENSUBTITLESORG_PASSWORD",
            (user, password) => new Dictionary<string, string>
            {
                ["username"] = user,
                ["password"] = password,
                ["vip"] = "true",
                ["ssl"] = "false",
            });
        AddIfConfigured("legendasdivx", "LEGENDASDIVX_USER", "LEGENDASDIVX_PASSWORD",
            (user, password) => new Dictionary<string, string>
            {
                ["username"] = user,
                ["password"] = password,
                ["skip_wrong_fps"] = "true",
            });
        AddIfConfigured("legendasnet", "LEGENDASNET_USER", "LEGENDASNET_PASSWORD",
            (user, password) => new Dictionary<string, string>
            {
                ["username"] = user,
                ["password"] = password,
            });
        using var response = await Http.SendAsync(
            client,
            HttpMethod.Post,
            baseUrl + "/api/system/settings",
            Http.Form(values),
            headers,
            expected: [HttpStatusCode.OK, HttpStatusCode.NoContent],
            cancellationToken: token);

        void AddIfConfigured(
            string provider,
            string userName,
            string passwordName,
            Func<string, string, IReadOnlyDictionary<string, string>> settings)
        {
            var user = Env.Optional(userName);
            var password = Env.Optional(passwordName);
            if (user.Length > 0 && password.Length > 0)
            {
                Add(provider, settings(user, password));
            }
        }
    }

    private async Task PostSettingsAsync(
        IEnumerable<KeyValuePair<string, string>> settings,
        CancellationToken token)
    {
        using var response = await Http.SendAsync(
            client,
            HttpMethod.Post,
            baseUrl + "/api/system/settings",
            Http.Form(settings),
            headers,
            expected: [HttpStatusCode.OK, HttpStatusCode.NoContent],
            cancellationToken: token);
    }
}

internal sealed class SeerrApi(
    string baseUrl,
    string jellyfinUrl,
    string username,
    string password,
    string apiKey)
{
    private readonly HttpClient client = new(new HttpClientHandler
    {
        UseCookies = true,
        CookieContainer = new CookieContainer(),
    })
    {
        Timeout = TimeSpan.FromSeconds(30),
    };

    public async Task ReconcileAsync(
        string sonarrUrl,
        string sonarrKey,
        string radarrUrl,
        string radarrKey,
        CancellationToken token)
    {
        var publicSettings = await Http.JsonAsync(
            client,
            HttpMethod.Get,
            baseUrl + "/api/v1/settings/public",
            cancellationToken: token);
        var initialized = publicSettings["initialized"]?.GetValue<bool>() is true;
        if (initialized)
        {
            await UpdateJellyfinAsync(token);
        }
        else
        {
            await AuthenticateAsync(token);
        }

        await ReconcileArrAsync("sonarr", sonarrUrl, sonarrKey, "/tv", token);
        await ReconcileArrAsync("radarr", radarrUrl, radarrKey, "/movies", token);
        if (!initialized)
        {
            await SendAsync(HttpMethod.Post, "/api/v1/settings/initialize", null, token);
        }
    }

    private IReadOnlyDictionary<string, string> Headers()
        => new Dictionary<string, string> { ["X-Api-Key"] = apiKey };

    private async Task UpdateJellyfinAsync(CancellationToken token)
    {
        var endpoint = new Uri(jellyfinUrl);
        await SendAsync(
            HttpMethod.Post,
            "/api/v1/settings/jellyfin",
            new JsonObject
            {
                ["ip"] = endpoint.Host,
                ["port"] = endpoint.IsDefaultPort ? 8096 : endpoint.Port,
                ["useSsl"] = endpoint.Scheme == "https",
                ["urlBase"] = endpoint.AbsolutePath == "/" ? "" : endpoint.AbsolutePath,
                ["externalHostname"] = "",
            },
            token);
    }

    private async Task AuthenticateAsync(CancellationToken token)
    {
        var jellyfin = new Uri(jellyfinUrl);
        var payload = new JsonObject
        {
            ["username"] = username,
            ["password"] = password,
            ["hostname"] = jellyfin.Host,
            ["port"] = jellyfin.IsDefaultPort ? 8096 : jellyfin.Port,
            ["useSsl"] = jellyfin.Scheme == "https",
            ["urlBase"] = "",
            ["serverType"] = 2,
        };
        try
        {
            await SendAnonymousAsync(
                HttpMethod.Post,
                "/api/v1/auth/jellyfin",
                payload,
                token);
        }
        catch (HttpFailure failure) when (
            failure.Status == HttpStatusCode.InternalServerError
            && failure.ResponseBody.Contains(
                "Jellyfin hostname already configured",
                StringComparison.Ordinal))
        {
            payload.Remove("hostname");
            payload.Remove("port");
            payload.Remove("useSsl");
            payload.Remove("urlBase");
            payload.Remove("serverType");
            await SendAnonymousAsync(
                HttpMethod.Post,
                "/api/v1/auth/jellyfin",
                payload,
                token);
        }
    }

    private async Task ReconcileArrAsync(
        string kind,
        string url,
        string key,
        string fallbackDirectory,
        CancellationToken token)
    {
        var endpoint = new Uri(url);
        var arrHeaders = new Dictionary<string, string> { ["X-Api-Key"] = key };
        var profiles = (await Http.JsonAsync(
            client,
            HttpMethod.Get,
            url + "/api/v3/qualityprofile",
            headers: arrHeaders,
            cancellationToken: token)).AsArray();
        var folders = (await Http.JsonAsync(
            client,
            HttpMethod.Get,
            url + "/api/v3/rootfolder",
            headers: arrHeaders,
            cancellationToken: token)).AsArray();
        var services = (await Http.JsonAsync(
            client,
            HttpMethod.Get,
            $"{baseUrl}/api/v1/settings/{kind}",
            headers: Headers(),
            cancellationToken: token)).AsArray();
        var profile = profiles.FirstOrDefault() as JsonObject;
        var anime = profiles.OfType<JsonObject>().FirstOrDefault(item =>
            item["name"]?.GetValue<string>() == "[Anime] Remux-1080p");
        var folder = folders.FirstOrDefault() as JsonObject;
        var name = kind == "sonarr" ? "Sonarr" : "Radarr";
        var existing = services.OfType<JsonObject>().FirstOrDefault(item =>
            item["name"]?.GetValue<string>() == name)
            ?? (services.Count == 1 ? services[0]?.AsObject() : null);
        var domain = Env.Required("TRAEFIK_DOMAIN");
        var ingressPort = Env.Integer("INGRESS_HTTPS_PORT", 443);
        var payload = new JsonObject
        {
            ["name"] = name,
            ["hostname"] = endpoint.Host,
            ["port"] = endpoint.IsDefaultPort ? kind == "sonarr" ? 8989 : 7878 : endpoint.Port,
            ["apiKey"] = key,
            ["useSsl"] = endpoint.Scheme == "https",
            ["activeProfileId"] = profile?["id"]?.DeepClone() ?? 1,
            ["activeProfileName"] = profile?["name"]?.DeepClone() ?? "Any",
            ["activeDirectory"] = folder?["path"]?.DeepClone() ?? fallbackDirectory,
            ["is4k"] = false,
            ["isDefault"] = true,
            ["externalUrl"] = PublicUrl(kind, domain, ingressPort),
            ["syncEnabled"] = true,
            ["preventSearch"] = false,
        };
        if (kind == "sonarr")
        {
            payload["enableSeasonFolders"] = true;
            payload["seriesType"] = "standard";
            payload["animeSeriesType"] = "anime";
            payload["activeAnimeProfileId"] = anime?["id"]?.DeepClone()
                ?? profile?["id"]?.DeepClone() ?? 1;
            payload["activeAnimeProfileName"] = anime?["name"]?.DeepClone()
                ?? profile?["name"]?.DeepClone() ?? "Any";
            payload["activeAnimeDirectory"] = folder?["path"]?.DeepClone() ?? fallbackDirectory;
            payload["animeTags"] = new JsonArray();
        }
        else
        {
            payload["minimumAvailability"] = "released";
        }

        var id = existing?["id"]?.ToString();
        await SendAsync(
            id is null ? HttpMethod.Post : HttpMethod.Put,
            $"/api/v1/settings/{kind}{(id is null ? "" : "/" + id)}",
            payload,
            token);
    }

    private Task SendAsync(HttpMethod method, string path, JsonNode? body, CancellationToken token)
        => SendAsync(method, path, body, Headers(), token);

    private Task SendAnonymousAsync(
        HttpMethod method,
        string path,
        JsonNode? body,
        CancellationToken token)
        => SendAsync(method, path, body, new Dictionary<string, string>(), token);

    private async Task SendAsync(
        HttpMethod method,
        string path,
        JsonNode? body,
        IReadOnlyDictionary<string, string> headers,
        CancellationToken token)
    {
        using var content = body is null ? null : JsonContent.Create(body);
        using var response = await Http.SendAsync(
            client,
            method,
            baseUrl + path,
            content,
            headers,
            cancellationToken: token);
    }

    private static string PublicUrl(string service, string domain, int port)
        => $"https://{service}.{domain}{(port == 443 ? "" : $":{port}")}";
}

internal sealed class DuplicatiApi(
    string baseUrl,
    string webPassword,
    string encryptionKey)
    : JsonApi(baseUrl)
{
    public async Task ReconcileAsync(CancellationToken token)
    {
        var authentication = await PostAsync(
            "/api/v1/auth/login",
            new JsonObject { ["Password"] = webPassword },
            token);
        var accessToken = authentication["accessToken"]?.GetValue<string>()
            ?? authentication["AccessToken"]?.GetValue<string>()
            ?? throw new InvalidOperationException("Duplicati returned no access token");
        var authHeaders = new Dictionary<string, string>
        {
            ["Authorization"] = $"Bearer {accessToken}",
        };
        var backups = (await Http.JsonAsync(
            Client,
            HttpMethod.Get,
            BaseUrl + "/api/v1/backups",
            headers: authHeaders,
            cancellationToken: token)).AsArray();
        if (backups.Any(item =>
            item?["Backup"]?["Name"]?.GetValue<string>() == "Arrspire Configuration"))
        {
            return;
        }

        var payload = JsonSerializer.SerializeToNode(new
        {
            Backup = new
            {
                Name = "Arrspire Configuration",
                Description = "Encrypted backup of Arrspire service configuration volumes",
                Tags = Array.Empty<string>(),
                TargetURL = "file:///backups/arrspire-config",
                Sources = new[] { "/source" },
                Settings = new object[]
                {
                    new { Filter = "", Name = "encryption-module", Value = "aes", Argument = (string?)null },
                    new { Filter = "", Name = "passphrase", Value = encryptionKey, Argument = (string?)null },
                },
                Filters = Array.Empty<string>(),
                Metadata = new { },
                IsTemporary = false,
                AdditionalTargetURLs = Array.Empty<string>(),
            },
            Schedule = new
            {
                Tags = Array.Empty<string>(),
                Time = "2020-01-01T13:00:00Z",
                Repeat = "1D",
                Rule = "AllowedWeekDays=Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday",
                AllowedDays = new[] { "mon", "tue", "wed", "thu", "fri", "sat", "sun" },
            },
        })!;
        using var content = JsonContent.Create(payload);
        using var response = await Http.SendAsync(
            Client,
            HttpMethod.Post,
            BaseUrl + "/api/v1/backups",
            content,
            authHeaders,
            cancellationToken: token);
    }
}

internal sealed class TdarrApi(string baseUrl) : JsonApi(baseUrl)
{
    public async Task ReconcileAsync(CancellationToken token)
    {
        var all = await PostAsync(
            "/api/v2/cruddb",
            Crud("getAll"),
            token);
        var libraries = all.AsArray();
        const string id = "arrspire-media";
        var desired = MediaLibrary();
        var exists = libraries.Any(library => library?["_id"]?.GetValue<string>() == id);
        await SendAsync(
            HttpMethod.Post,
            "/api/v2/cruddb",
            Crud(exists ? "update" : "insert", id, desired),
            token);
        foreach (var library in libraries.OfType<JsonObject>().Where(library =>
            library["_id"]?.GetValue<string>() is not null and not id
            && library["name"]?.GetValue<string>() == "Library Name"
            && (library["folder"]?.GetValue<string>() ?? "") == ""))
        {
            await SendAsync(
                HttpMethod.Post,
                "/api/v2/cruddb",
                Crud("removeOne", library["_id"]!.GetValue<string>()),
                token);
        }

        var nodes = (await GetAsync("/api/v2/get-nodes", token)).AsObject();
        var internalNode = nodes.FirstOrDefault(pair =>
            pair.Value?["nodeName"]?.GetValue<string>() == "InternalNode");
        if (internalNode.Key is null)
        {
            throw new InvalidOperationException("Tdarr InternalNode is not connected");
        }

        if ((internalNode.Value?["workerLimits"]?["healthcheckcpu"]?.GetValue<int>() ?? 0) < 1)
        {
            await SendAsync(
                HttpMethod.Post,
                "/api/v2/alter-worker-limit",
                JsonSerializer.SerializeToNode(new
                {
                    data = new
                    {
                        nodeID = internalNode.Key,
                        process = "increase",
                        workerType = "healthcheckcpu",
                    },
                })!,
                token);
        }

        await SendAsync(
            HttpMethod.Post,
            "/api/v2/scan-files",
            JsonSerializer.SerializeToNode(new
            {
                data = new
                {
                    scanConfig = new
                    {
                        dbID = id,
                        mode = "scanFindNew",
                        arrayOrPath = "/media",
                    },
                },
            })!,
            token);
    }

    internal static JsonObject MediaLibrary()
        => JsonSerializer.SerializeToNode(new
        {
            _id = "arrspire-media",
            priority = 0,
            name = "Arrspire Media",
            folder = "/media",
            foldersToIgnore = "",
            foldersToIgnoreCaseInsensitive = false,
            folderWatchScanInterval = 30,
            scannerThreadCount = 2,
            cache = "/temp",
            output = "",
            folderToFolderConversion = false,
            folderToFolderConversionDeleteSource = false,
            folderToFolderRecordHistory = true,
            copyIfConditionsMet = false,
            container = ".mkv",
            containerFilter = "mkv,mp4,mov,m4v,mpg,mpeg,avi,flv,webm,wmv,vob,evo,iso,m2ts,ts,mp3,m4a,flac,ogg,opus,wav",
            createdAt = 1_675_837_380_368,
            folderWatching = true,
            useFsEvents = true,
            scheduledScanFindNew = true,
            processLibrary = true,
            processTranscodes = false,
            processHealthChecks = true,
            scanOnStart = true,
            exifToolScan = true,
            mediaInfoScan = true,
            ffprobeShowData = false,
            isDirectoryLibrary = false,
            closedCaptionScan = false,
            scanButtons = true,
            scanFound = "",
            navItemSelected = "navSourceFolder",
            pluginIDs = Array.Empty<string>(),
            pluginCommunity = true,
            handbrake = true,
            ffmpeg = false,
            handbrakescan = true,
            ffmpegscan = false,
            preset = "-Z \"Very Fast 1080p30\"",
            decisionMaker = new
            {
                settingsPlugin = false,
                settingsFlows = false,
                settingsVideo = false,
                settingsAudio = false,
            },
            schedule = new[] { "Sun", "Mon", "Tue", "Wed", "Thur", "Fri", "Sat" }
                .SelectMany(day => Enumerable.Range(0, 24).Select(hour => new
                {
                    _id = $"{day}:{hour:00}-{(hour + 1) % 24:00}",
                    @checked = true,
                })),
            totalHealthCheckCount = 0,
            totalTranscodeCount = 0,
            sizeDiff = 0,
            holdNewFiles = false,
            holdFor = 3600,
            holdForDisplayUnit = "hours",
            pluginStackOverview = true,
            filterResolutionsSkip = "",
            filterCodecsSkip = "",
            filterContainersSkip = "",
            filterHardlinked = false,
            processPluginsSequentially = true,
        })!.AsObject();

    internal static JsonObject Crud(
        string mode,
        string? id = null,
        JsonObject? value = null)
    {
        var data = new JsonObject
        {
            ["collection"] = "LibrarySettingsJSONDB",
            ["mode"] = mode,
        };
        if (id is not null)
        {
            data["docID"] = id;
        }
        if (value is not null)
        {
            data["obj"] = value.DeepClone();
        }
        return new JsonObject { ["data"] = data };
    }
}
