using System.Diagnostics;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Arrspire.ControlPlane;

internal sealed record RoutedService(
    string Url,
    string Authentication,
    IReadOnlyList<string>? Aliases = null,
    IReadOnlyList<string>? Hosts = null);

internal static partial class Bootstrap
{
    private static readonly string[] DataDirectories =
    [
        "authelia/config", "authelia/secrets", "backups", "bazarr", "diun",
        "duplicati", "fail2ban/filter.d", "fail2ban/jail.d", "gluetun", "grafana",
        "grafana-provisioning/datasources", "homepage/secrets", "jellyfin",
        "jellyfin-cache", "jellyseerr", "lidarr", "prometheus", "prometheus-config",
        "prowlarr", "qbittorrent/qBittorrent", "radarr", "recyclarr", "sonarr",
        "status", "tdarr/configs", "tdarr/logs", "tdarr/server",
        "tdarr/transcode-cache", "traefik/acme", "traefik/dynamic", "traefik/logs",
    ];

    private static readonly (string Name, int Port)[] ArrServices =
    [
        ("sonarr", 8989),
        ("radarr", 7878),
        ("lidarr", 8686),
        ("prowlarr", 9696),
    ];

    public static async Task RunAsync(CancellationToken cancellationToken)
    {
        Log.Info("Starting deterministic bootstrap");
        Validation.ValidateConfiguration();
        foreach (var path in DataDirectories)
        {
            Directory.CreateDirectory(Path.Combine("/data", path));
        }

        foreach (var directory in RuntimeDirectories())
        {
            Directory.CreateDirectory(directory.Path);
            UnixOwnership.Chown(directory.Path, directory.Uid, directory.Gid, directory.Recursive);
        }

        await PluginInstaller.InstallAsync(cancellationToken);
        var qbitPassword = Env.Required("QBITTORRENT_PASSWORD");
        await AtomicFiles.WriteOnceAsync(
            "/data/qbittorrent/qBittorrent/qBittorrent.conf",
            QBittorrentConfiguration(qbitPassword),
            cancellationToken: cancellationToken);
        foreach (var service in ArrServices)
        {
            await AtomicFiles.WriteOnceAsync(
                $"/data/{service.Name}/config.xml",
                ArrConfiguration(service.Name, service.Port),
                cancellationToken: cancellationToken);
        }

        var domain = Env.Optional("TRAEFIK_DOMAIN", "192.168.0.15.nip.io");
        var httpsPort = Env.Integer("TRAEFIK_HTTPS_PORT", 443);
        var services = RoutedServices(domain);
        var keys = ArrServices.ToDictionary(
            service => service.Name,
            service => ApiKeys.ReadArr(service.Name),
            StringComparer.Ordinal);
        await Recyclarr.WriteConfigurationAsync(
            Env.Required("SONARR_URL"),
            keys["sonarr"],
            Env.Required("RADARR_URL"),
            keys["radarr"],
            cancellationToken);

        var publicMode = UnixFileMode.UserRead | UnixFileMode.UserWrite
            | UnixFileMode.GroupRead | UnixFileMode.OtherRead;
        var secretMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        var writes = new List<Task>
        {
            AtomicFiles.WriteIfChangedAsync(
                "/data/authelia/config/configuration.yml",
                AutheliaConfiguration(domain, httpsPort),
                publicMode,
                cancellationToken),
            AtomicFiles.WriteIfChangedAsync(
                "/data/authelia/config/users_database.yml",
                AutheliaUsersDatabase(
                    Env.Required("INGRESS_ADMIN_USER"),
                    Env.Required("INGRESS_ADMIN_PASSWORD"),
                    Env.Required("AUTHELIA_SESSION_SECRET"),
                    domain),
                secretMode,
                cancellationToken),
            AtomicFiles.WriteIfChangedAsync(
                "/data/authelia/secrets/session-secret",
                Env.Required("AUTHELIA_SESSION_SECRET"),
                secretMode,
                cancellationToken),
            AtomicFiles.WriteIfChangedAsync(
                "/data/authelia/secrets/storage-encryption-key",
                Env.Required("AUTHELIA_STORAGE_ENCRYPTION_KEY"),
                secretMode,
                cancellationToken),
            AtomicFiles.WriteIfChangedAsync(
                "/data/traefik/dynamic/services.yml",
                TraefikDynamicConfiguration(
                    domain,
                    services,
                    Env.Required("AUTH_URL"),
                    Env.Optional("TRAEFIK_TLS_MODE", "local")),
                publicMode,
                cancellationToken),
            AtomicFiles.WriteIfChangedAsync(
                "/data/fail2ban/filter.d/traefik-auth.conf",
                Fail2banFilter,
                publicMode,
                cancellationToken),
            AtomicFiles.WriteIfChangedAsync(
                "/data/fail2ban/jail.d/traefik.conf",
                Fail2banJail,
                publicMode,
                cancellationToken),
            AtomicFiles.WriteIfChangedAsync(
                "/data/prometheus-config/prometheus.yml",
                PrometheusConfiguration,
                publicMode,
                cancellationToken),
            AtomicFiles.WriteIfChangedAsync(
                "/data/grafana-provisioning/datasources/prometheus.yml",
                GrafanaDatasource(services["prometheus"].Url),
                publicMode,
                cancellationToken),
            AtomicFiles.WriteIfChangedAsync(
                "/data/homepage/settings.yaml",
                HomepageSettings(),
                publicMode,
                cancellationToken),
            AtomicFiles.WriteIfChangedAsync(
                "/data/homepage/services.yaml",
                HomepageServices(domain, httpsPort, services),
                publicMode,
                cancellationToken),
        };
        foreach (var (name, content) in new Dictionary<string, string>
        {
            ["bookmarks.yaml"] = "[]\n",
            ["widgets.yaml"] = "[]\n",
            ["docker.yaml"] = "{}\n",
            ["kubernetes.yaml"] = "---\n",
            ["proxmox.yaml"] = "---\n",
            ["custom.css"] = "",
            ["custom.js"] = "",
        })
        {
            writes.Add(AtomicFiles.WriteIfChangedAsync(
                $"/data/homepage/{name}",
                content,
                publicMode,
                cancellationToken));
        }

        foreach (var secret in new Dictionary<string, string>
        {
            ["sonarr-key"] = keys["sonarr"],
            ["radarr-key"] = keys["radarr"],
            ["lidarr-key"] = keys["lidarr"],
            ["prowlarr-key"] = keys["prowlarr"],
            ["qbittorrent-password"] = qbitPassword,
        })
        {
            writes.Add(AtomicFiles.WriteIfChangedAsync(
                $"/data/homepage/secrets/{secret.Key}",
                secret.Value,
                secretMode,
                cancellationToken));
        }

        await Task.WhenAll(writes);
        await Status.WriteBootstrapAsync(cancellationToken);
        Log.Info("Bootstrap completed");
    }

    internal static IReadOnlyList<(string Path, uint Uid, uint Gid, bool Recursive)>
        RuntimeDirectories()
        =>
        [
            ("/data/grafana", 472, 0, false),
            ("/data/prometheus", 65_534, 65_534, false),
            ("/data/recyclarr", 1000, 1000, false),
            ("/data/jellyseerr", 1000, 1000, true),
            ("/media/movies", 1000, 1000, false),
            ("/media/tv", 1000, 1000, false),
            ("/media/music", 1000, 1000, false),
            ("/downloads", 1000, 1000, false),
            ("/downloads/incomplete", 1000, 1000, false),
            ("/downloads/sonarr", 1000, 1000, false),
            ("/downloads/radarr", 1000, 1000, false),
            ("/downloads/lidarr", 1000, 1000, false),
        ];

    internal static string QBittorrentConfiguration(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            100_000,
            HashAlgorithmName.SHA512,
            64);
        return $$"""
            [Application]
            FileLogger\Age=1
            FileLogger\AgeType=1
            FileLogger\Backup=true
            FileLogger\DeleteOld=true
            FileLogger\Enabled=true
            FileLogger\MaxSizeBytes=66560
            FileLogger\Path=/config/qBittorrent/logs

            [BitTorrent]
            Session\DefaultSavePath=/downloads
            Session\Port=6881
            Session\TempPath=/downloads/incomplete

            [LegalNotice]
            Accepted=true

            [Preferences]
            WebUI\Address=*
            WebUI\HostHeaderValidation=false
            WebUI\Password_PBKDF2="@ByteArray({{Convert.ToBase64String(salt)}}:{{Convert.ToBase64String(hash)}})"
            WebUI\Port=8080
            WebUI\Username=admin

            """;
    }

    internal static string ArrConfiguration(string name, int port)
    {
        var apiKey = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16));
        return $"""
            <Config>
              <LogLevel>info</LogLevel>
              <BindAddress>*</BindAddress>
              <Port>{port}</Port>
              <SslPort>{port + 1}</SslPort>
              <EnableSsl>False</EnableSsl>
              <LaunchBrowser>False</LaunchBrowser>
              <ApiKey>{apiKey}</ApiKey>
              <AuthenticationMethod>External</AuthenticationMethod>
              <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>
              <Branch>master</Branch>
              <InstanceName>{char.ToUpperInvariant(name[0])}{name[1..]}</InstanceName>
            </Config>
            """;
    }

    internal static string AutheliaUsersDatabase(
        string username,
        string password,
        string sessionSecret,
        string domain)
    {
        var salt = SHA256.HashData(
            Encoding.UTF8.GetBytes(
                $"arrspire-authelia-password\0{sessionSecret}\0{username}"))[..16];
        var digest = Rfc2898DeriveBytes.Pbkdf2(
            password,
            salt,
            310_000,
            HashAlgorithmName.SHA512,
            64);
        var encodedSalt = AdaptedBase64(salt);
        var encodedDigest = AdaptedBase64(digest);
        var passwordHash = $"$pbkdf2-sha512$310000${encodedSalt}${encodedDigest}";
        return $"""
            users:
              {Yaml(username)}:
                disabled: false
                displayname: "Arrspire Administrator"
                password: {Yaml(passwordHash)}
                email: {Yaml($"arrspire@{domain}")}
                groups:
                  - admins

            """;
    }

    internal static string AutheliaConfiguration(string domain, int httpsPort)
        => $$"""
            theme: auto
            server:
              address: "tcp://:9091/"
              endpoints:
                authz:
                  forward-auth:
                    implementation: ForwardAuth
            log:
              level: info
              format: text
            authentication_backend:
              password_reset:
                disable: true
              password_change:
                disable: true
              file:
                path: /config/users_database.yml
                watch: false
            access_control:
              default_policy: deny
              rules:
                - domain:
                    - {{Yaml(domain)}}
                    - {{Yaml($"*.{domain}")}}
                  policy: one_factor
            session:
              name: arrspire_session
              same_site: lax
              inactivity: 1h
              expiration: 12h
              remember_me: 1M
              cookies:
                - domain: {{Yaml(domain)}}
                  authelia_url: {{Yaml(PublicUrl("auth", domain, httpsPort))}}
                  default_redirection_url: {{Yaml(PublicRootUrl(domain, httpsPort))}}
            storage:
              local:
                path: /config/db.sqlite3
            notifier:
              filesystem:
                filename: /config/notification.txt

            """;

    internal static string TraefikDynamicConfiguration(
        string domain,
        IReadOnlyDictionary<string, RoutedService> services,
        string autheliaUrl,
        string tlsMode)
    {
        var routers = new StringBuilder();
        var backends = new StringBuilder();
        var tls = tlsMode == "cloudflare-acme"
            ? "      tls:\n        certResolver: letsencrypt"
            : "      tls: {}";
        foreach (var (name, service) in services)
        {
            var hosts = service.Hosts
                ?? new[] { name }.Concat(service.Aliases ?? []).Select(host => $"{host}.{domain}").ToArray();
            var rules = string.Join(" || ", hosts.Select(host => $"Host(`{host}`)"));
            routers.AppendLine($"""
                    {name}:
                      rule: '{rules}'
                      entryPoints: [websecure]
                      service: {name}
                {tls}
                {(RequiresIngressAuthentication(service.Authentication) ? "      middlewares: [admin-auth]" : "")}
                """);
            backends.AppendLine($"""
                    {name}:
                      loadBalancer:
                        servers:
                          - url: {Yaml(service.Url)}
                """);
        }

        routers.AppendLine($"""
                traefik-dashboard:
                  rule: 'Host(`traefik.{domain}`)'
                  entryPoints: [websecure]
                  service: api@internal
                  middlewares: [admin-auth]
            {tls}
            """);
        var authorization = new Uri(new Uri(autheliaUrl.TrimEnd('/') + "/"), "api/authz/forward-auth");
        return $$"""
            http:
              middlewares:
                admin-auth:
                  forwardAuth:
                    address: {{Yaml(authorization.ToString())}}
                    trustForwardHeader: true
                    maxResponseBodySize: 8192
                    authResponseHeaders:
                      - Remote-User
                      - Remote-Groups
                      - Remote-Email
                      - Remote-Name
              routers:
            {{routers}}  services:
            {{backends}}
            """;
    }

    internal static string HomepageSettings()
        => """
           title: Arrspire
           description: Media, requests, automation, and operations
           theme: dark
           color: slate
           headerStyle: boxedWidgets
           statusStyle: dot
           hideVersion: true
           disableIndexing: true
           target: _self
           layout:
             Watch and Request:
               style: row
               columns: 2
             Library Automation:
               style: row
               columns: 4
             Downloads and Processing:
               style: row
               columns: 4
             Operations:
               style: row
               columns: 5

           """;

    internal static string HomepageServices(
        string domain,
        int httpsPort,
        IReadOnlyDictionary<string, RoutedService> services)
    {
        static string Card(
            string title,
            string route,
            string icon,
            string description,
            string url,
            string health,
            string? widget = null)
        {
            var output = new StringBuilder()
                .AppendLine($"    - {title}:")
                .AppendLine($"        icon: {icon}")
                .AppendLine($"        href: {Yaml(route)}")
                .AppendLine($"        description: {Yaml(description)}")
                .AppendLine($"        siteMonitor: {Yaml(url + health)}")
                .ToString();
            return widget is null ? output : output + widget;
        }

        string Route(string name) => PublicUrl(name, domain, httpsPort);
        static string Widget(
            string type,
            string? secret = null,
            string? username = null,
            string? passwordSecret = null,
            IReadOnlyList<string>? fields = null)
        {
            var output = new StringBuilder()
                .AppendLine("        widget:")
                .AppendLine($"          type: {type}")
                .AppendLine("          url: __URL__")
                .ToString();
            if (secret is not null)
            {
                output += "          key: \"{{HOMEPAGE_FILE_"
                    + secret
                    + "}}\"\n";
            }
            if (username is not null)
            {
                output += $"          username: {username}\n";
            }
            if (passwordSecret is not null)
            {
                output += "          password: \"{{HOMEPAGE_FILE_"
                    + passwordSecret
                    + "}}\"\n";
            }
            if (fields is not null)
            {
                output += $"          fields: [{string.Join(", ", fields.Select(Yaml))}]\n";
            }

            return output;
        }

        static string WithWidgetUrl(string widget, string url)
            => widget.Replace("__URL__", Yaml(url), StringComparison.Ordinal);

        return "- Watch and Request:\n"
            + Card("Jellyfin", Route("jellyfin"), "jellyfin.png", "Watch movies, series, and music", services["jellyfin"].Url, "/health")
            + Card("Seerr", Route("seerr"), "seerr.png", "Request movies and series", services["seerr"].Url, "/api/v1/status")
            + "\n- Library Automation:\n"
            + Card("Sonarr", Route("sonarr"), "sonarr.png", "Series library", services["sonarr"].Url, "/ping",
                WithWidgetUrl(Widget("sonarr", "SONARR_KEY", fields: ["wanted", "queued"]), services["sonarr"].Url))
            + Card("Radarr", Route("radarr"), "radarr.png", "Movie library", services["radarr"].Url, "/ping",
                WithWidgetUrl(Widget("radarr", "RADARR_KEY", fields: ["wanted", "queued"]), services["radarr"].Url))
            + Card("Lidarr", Route("lidarr"), "lidarr.png", "Music library", services["lidarr"].Url, "/ping",
                WithWidgetUrl(Widget("lidarr", "LIDARR_KEY"), services["lidarr"].Url))
            + Card("Prowlarr", Route("prowlarr"), "prowlarr.png", "Indexer management", services["prowlarr"].Url, "/ping",
                WithWidgetUrl(Widget("prowlarr", "PROWLARR_KEY"), services["prowlarr"].Url))
            + "\n- Downloads and Processing:\n"
            + Card("qBittorrent", Route("qbittorrent"), "qbittorrent.png", "Download queue", services["qbittorrent"].Url, "/",
                WithWidgetUrl(Widget("qbittorrent", username: "admin", passwordSecret: "QBITTORRENT_PASSWORD"), services["qbittorrent"].Url))
            + Card("Bazarr", Route("bazarr"), "bazarr.png", "Subtitle automation", services["bazarr"].Url, "/")
            + Card("Tdarr", Route("tdarr"), "tdarr.png", "Media health and transcoding", services["tdarr"].Url, "/api/v2/status",
                WithWidgetUrl(Widget("tdarr"), services["tdarr"].Url))
            + Card("Duplicati", Route("duplicati"), "duplicati.png", "Configuration backups", services["duplicati"].Url, "/ngclient/")
            + "\n- Operations:\n"
            + Card("Authelia", Route("auth"), "authelia.png", "Identity and access management", services["auth"].Url, "/api/health")
            + Card("Grafana", Route("grafana"), "grafana.png", "Metrics dashboards", services["grafana"].Url, "/api/health")
            + Card("Prometheus", Route("prometheus"), "prometheus.png", "Metrics collection", services["prometheus"].Url, "/-/healthy")
            + Card("Aspire", Route("aspire"), "microsoft-azure.png", "Resources, logs, traces, and commands", services["aspire"].Url, "/")
            + Card("Traefik", Route("traefik"), "traefik-proxy.png", "Ingress routes and TLS", "http://traefik:8080", "/ping");
    }

    private static IReadOnlyDictionary<string, RoutedService> RoutedServices(string domain)
        => new Dictionary<string, RoutedService>(StringComparer.Ordinal)
        {
            ["auth"] = new(Env.Required("AUTH_URL"), "identity"),
            ["aspire"] = new(Env.Optional("ASPIRE_DASHBOARD_URL", "http://arrspire-dashboard:18888"), "ingress"),
            ["bazarr"] = new(Env.Required("BAZARR_URL"), "ingress"),
            ["duplicati"] = new(Env.Required("DUPLICATI_URL"), "service"),
            ["grafana"] = new(Env.Required("GRAFANA_URL"), "ingress+service"),
            ["homepage"] = new(Env.Required("HOMEPAGE_URL"), "ingress", Hosts: [domain, $"home.{domain}"]),
            ["jellyfin"] = new(Env.Required("JELLYFIN_URL"), "service"),
            ["seerr"] = new(Env.Required("SEERR_URL"), "service", Aliases: ["jellyseerr"]),
            ["lidarr"] = new(Env.Required("LIDARR_URL"), "ingress"),
            ["prometheus"] = new(Env.Required("PROMETHEUS_URL"), "ingress"),
            ["prowlarr"] = new(Env.Required("PROWLARR_URL"), "ingress"),
            ["qbittorrent"] = new(Env.Required("QBITTORRENT_URL"), "ingress+service"),
            ["radarr"] = new(Env.Required("RADARR_URL"), "ingress"),
            ["sonarr"] = new(Env.Required("SONARR_URL"), "ingress"),
            ["tdarr"] = new(Env.Required("TDARR_URL"), "ingress"),
        };

    private static bool RequiresIngressAuthentication(string mode)
        => mode is "ingress" or "ingress+service";

    private static string GrafanaDatasource(string prometheusUrl)
        => $"""
            apiVersion: 1
            datasources:
              - name: Prometheus
                uid: prometheus
                type: prometheus
                access: proxy
                url: {prometheusUrl}
                isDefault: true
                editable: false

            """;

    private static string PublicUrl(string service, string domain, int port)
        => $"https://{service}.{domain}{(port == 443 ? "" : $":{port}")}";

    private static string PublicRootUrl(string domain, int port)
        => $"https://{domain}{(port == 443 ? "" : $":{port}")}";

    private static string Yaml(string value) => JsonSerializer.Serialize(value);

    private static string AdaptedBase64(byte[] value)
        => Convert.ToBase64String(value).TrimEnd('=').Replace('+', '.');

    private const string Fail2banFilter = """
        [Definition]
        failregex = ^<HOST> .* "(GET|POST|HEAD).*" (401|403|429) .*
        ignoreregex =

        """;

    private const string Fail2banJail = """
        [traefik-auth]
        enabled = true
        filter = traefik-auth
        logpath = /var/log/traefik/access.log
        backend = polling
        maxretry = 10
        findtime = 10m
        bantime = 1h

        """;

    private const string PrometheusConfiguration = """
        global:
          scrape_interval: 15s
          evaluation_interval: 15s

        scrape_configs:
          - job_name: prometheus
            static_configs:
              - targets: ["localhost:9090"]

        """;
}

internal static partial class ApiKeys
{
    public static string ReadArr(string service)
    {
        var path = $"/data/{service}/config.xml";
        var match = ApiKeyRegex().Match(File.ReadAllText(path));
        return match.Success
            ? match.Groups[1].Value
            : throw new InvalidOperationException($"No API key found in {path}");
    }

    public static async Task<string> ReadBazarrAsync(CancellationToken cancellationToken)
        => await Retry.ExecuteAsync(
            async token =>
            {
                var path = "/data/bazarr/config/config.yaml";
                var match = BazarrKeyRegex().Match(await File.ReadAllTextAsync(path, token));
                return match.Success
                    ? match.Groups[1].Value
                    : throw new InvalidOperationException($"No auth.apikey found in {path}");
            },
            60,
            TimeSpan.FromSeconds(2),
            TimeSpan.FromSeconds(2),
            cancellationToken);

    public static string ReadSeerr()
    {
        using var document = JsonDocument.Parse(
            File.ReadAllText("/data/jellyseerr/settings.json"));
        return document.RootElement.GetProperty("main").GetProperty("apiKey").GetString()
            is { Length: > 0 } key
                ? key
                : throw new InvalidOperationException("No Seerr main.apiKey found");
    }

    [GeneratedRegex("<ApiKey>([^<]+)</ApiKey>")]
    private static partial Regex ApiKeyRegex();

    [GeneratedRegex(
        "^auth:\\s*\\n(?:[ \\t]+[^\\n]*\\n)*?[ \\t]+apikey:\\s*[\"']?([^\"'#\\s]+)",
        RegexOptions.Multiline)]
    private static partial Regex BazarrKeyRegex();
}

internal static class Recyclarr
{
    public static string Configuration(
        string sonarrUrl,
        string sonarrKey,
        string radarrUrl,
        string radarrKey)
        => $"""
            # yaml-language-server: $schema=https://raw.githubusercontent.com/recyclarr/recyclarr/master/schemas/config-schema.json
            # Generated by Arrspire's idempotent C# control plane.
            sonarr:
              tv-shows:
                base_url: {sonarrUrl}
                api_key: {sonarrKey}
                delete_old_custom_formats: true
                quality_definition:
                  type: series
                quality_profiles:
                  - trash_id: 72dae194fc92bf828f32cde7744e51a1 # WEB-1080p
                    reset_unmatched_scores:
                      enabled: true
                  - trash_id: 20e0fc959f1f1704bed501f23bdae76f # [Anime] Remux-1080p
                    reset_unmatched_scores:
                      enabled: true

            radarr:
              movies:
                base_url: {radarrUrl}
                api_key: {radarrKey}
                delete_old_custom_formats: true
                quality_definition:
                  type: movie
                quality_profiles:
                  - trash_id: d1d67249d3890e49bc12e275d989a7e9 # HD Bluray + WEB
                    reset_unmatched_scores:
                      enabled: true

            """;

    public static async Task WriteConfigurationAsync(
        string sonarrUrl,
        string sonarrKey,
        string radarrUrl,
        string radarrKey,
        CancellationToken cancellationToken)
    {
        var path = "/data/recyclarr/recyclarr.yml";
        var changed = await AtomicFiles.WriteIfChangedAsync(
            path,
            Configuration(sonarrUrl, sonarrKey, radarrUrl, radarrKey),
            cancellationToken: cancellationToken);
        UnixOwnership.Chown(path, 1000, 1000, recursive: false);
        Log.Info("Recyclarr configuration reconciled", new { changed });
    }
}

internal static class UnixOwnership
{
    public static void Chown(string path, uint uid, uint gid, bool recursive)
    {
        if (!OperatingSystem.IsLinux())
        {
            return;
        }

        ChownCore(path, uid, gid);
        if (recursive && Directory.Exists(path))
        {
            foreach (var child in Directory.EnumerateFileSystemEntries(
                path,
                "*",
                SearchOption.AllDirectories))
            {
                ChownCore(child, uid, gid);
            }
        }
    }

    private static void ChownCore(string path, uint uid, uint gid)
    {
        if (chown(path, uid, gid) != 0)
        {
            throw new IOException(
                $"chown failed for {path}: {Marshal.GetLastPInvokeErrorMessage()}");
        }
    }

    [DllImport("libc", SetLastError = true)]
    private static extern int chown(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string path,
        uint owner,
        uint group);
}

internal static class PluginInstaller
{
    private sealed record Plugin(
        string Name,
        string Directory,
        string Version,
        Uri Url,
        string Md5);

    private static readonly Plugin[] Plugins =
    [
        new("File Transformation", "FileTransformation", "2.5.11.0",
            new("https://github.com/IAmParadox27/jellyfin-plugin-file-transformation/releases/download/2.5.11.0/Release-10.11.11.zip"),
            "31fcd58d863995c0a3047d2266d72ef6"),
        new("Jellyfin Enhanced", "JellyfinEnhanced", "12.0.0.0",
            new("https://github.com/n00bcodr/Jellyfin-Enhanced/releases/download/12.0.0.0/Jellyfin.Plugin.JellyfinEnhanced_10.11.0.zip"),
            "6b52d47a302c244ff6d256389a055413"),
        new("Intro Skipper", "IntroSkipper", "1.10.11.22",
            new("https://github.com/intro-skipper/intro-skipper/releases/download/10.11/v1.10.11.22/intro-skipper-v1.10.11.22.zip"),
            "7507b1915039c94cf67c450e4612fb37"),
        new("TheTVDB", "TheTVDB", "22.0.0.0",
            new("https://github.com/jellyfin/jellyfin-plugin-tvdb/releases/download/v22/thetvdb_22.0.0.0.zip"),
            "dff31b428c9416d67ac78f515852d2cb"),
        new("Bazarr", "Bazarr", "1.1.2.0",
            new("https://github.com/enoch85/bazarr-jellyfin/releases/download/v1.1.2/Jellyfin.Plugin.Bazarr.zip"),
            "1833bf8bc8bf8b51ad178c30fd2e9147"),
    ];

    public static async Task InstallAsync(CancellationToken cancellationToken)
    {
        const string root = "/data/jellyfin/plugins";
        Directory.CreateDirectory(root);
        foreach (var plugin in Plugins)
        {
            try
            {
                await InstallAsync(root, plugin, cancellationToken);
            }
            catch (Exception exception)
            {
                Log.Warning("Jellyfin plugin installation deferred", new
                {
                    plugin = plugin.Name,
                    error = exception.Message,
                });
            }
        }
    }

    internal static IReadOnlyList<string> ObsoleteDirectories(
        string directory,
        string version,
        IEnumerable<string> entries)
    {
        var prefix = directory + "_";
        var target = prefix + version;
        return entries.Where(entry =>
            entry.StartsWith(prefix, StringComparison.Ordinal)
            && entry != target).ToArray();
    }

    private static async Task InstallAsync(
        string root,
        Plugin plugin,
        CancellationToken cancellationToken)
    {
        var target = Path.Combine(root, $"{plugin.Directory}_{plugin.Version}");
        if (Directory.Exists(target)
            && Directory.EnumerateFiles(target, "*.dll", SearchOption.AllDirectories).Any())
        {
            RemoveObsolete(root, plugin);
            return;
        }

        var temporary = Path.Combine(root, $".arrspire-plugin-{Guid.NewGuid():N}");
        Directory.CreateDirectory(temporary);
        try
        {
            var archive = Path.Combine(temporary, "plugin.zip");
            using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(2) };
            await using (var output = File.Create(archive))
            await using (var input = await client.GetStreamAsync(plugin.Url, cancellationToken))
            {
                await input.CopyToAsync(output, cancellationToken);
            }

            var checksum = Convert.ToHexStringLower(MD5.HashData(await File.ReadAllBytesAsync(
                archive,
                cancellationToken)));
            if (checksum != plugin.Md5)
            {
                throw new InvalidOperationException($"checksum mismatch for {plugin.Name}");
            }

            var extracted = Path.Combine(temporary, "extracted");
            ZipFile.ExtractToDirectory(archive, extracted, overwriteFiles: true);
            if (!Directory.EnumerateFiles(extracted, "*.dll", SearchOption.AllDirectories).Any())
            {
                throw new InvalidOperationException(
                    $"archive for {plugin.Name} contains no plugin assembly");
            }

            if (Directory.Exists(target))
            {
                Directory.Delete(target, recursive: true);
            }

            Directory.Move(extracted, target);
            RemoveObsolete(root, plugin);
            Log.Info("Jellyfin plugin installed", new
            {
                plugin = plugin.Name,
                version = plugin.Version,
            });
        }
        finally
        {
            if (Directory.Exists(temporary))
            {
                Directory.Delete(temporary, recursive: true);
            }
        }
    }

    private static void RemoveObsolete(string root, Plugin plugin)
    {
        foreach (var name in ObsoleteDirectories(
            plugin.Directory,
            plugin.Version,
            Directory.EnumerateDirectories(root).Select(Path.GetFileName)!))
        {
            Directory.Delete(Path.Combine(root, name), recursive: true);
        }
    }
}
