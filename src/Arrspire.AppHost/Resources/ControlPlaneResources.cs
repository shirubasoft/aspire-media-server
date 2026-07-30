using Aspire.Hosting.ApplicationModel;

namespace Arrspire.AppHost.Resources;

internal sealed record ControlPlaneEndpoints(
    EndpointReference GluetunProxy,
    EndpointReference Ingress,
    EndpointReference Notifier,
    EndpointReference Sonarr,
    EndpointReference Radarr,
    EndpointReference Lidarr,
    EndpointReference Prowlarr,
    EndpointReference Bazarr,
    EndpointReference Jellyfin,
    EndpointReference Seerr,
    EndpointReference QBittorrent,
    EndpointReference Tdarr,
    EndpointReference Duplicati,
    EndpointReference Homepage,
    EndpointReference Auth,
    EndpointReference Prometheus,
    EndpointReference Grafana);

internal static class ControlPlaneResources
{
    public static HttpResourceHandle AddNotifier(
        ArrspireContext context,
        HttpResourceHandle homepage)
    {
        var resource = AddControlPlane(context, "notifier", "serve-notifications", false)
            .WithEnvironment("PORT", "8080")
            .WithEnvironment("NTFY_ENDPOINT", context.Parameters.NtfyEndpoint)
            .WithEnvironment("NTFY_TOPIC", context.Parameters.NtfyTopic)
            .WithEnvironment("NTFY_TOKEN", context.Parameters.NtfyToken)
            .WithEnvironment(
                "ARRSPIRE_HOME_URL",
                ReferenceExpression.Create($"{homepage.Http}"))
            .WithEndpoint(targetPort: 8080, scheme: "http", name: "http")
            .WithHttpHealthCheck("/healthz")
            .WithComposeRestart();
        return resource.HttpHandle("notifier");
    }

    public static ResourceHandle AddDiun(
        ArrspireContext context,
        HttpResourceHandle notifier)
    {
        var resource = context.Builder
            .AddContainer("diun", ArrspireImages.Diun)
            .WithEnvironment("TZ", context.Parameters.Timezone)
            .WithEnvironment("LOG_LEVEL", "info")
            .WithEnvironment("LOG_JSON", "false")
            .WithEnvironment("DIUN_WATCH_WORKERS", "20")
            .WithEnvironment("DIUN_WATCH_SCHEDULE", "0 */6 * * *")
            .WithEnvironment("DIUN_PROVIDERS_DOCKER", "true")
            .WithEnvironment("DIUN_PROVIDERS_DOCKER_WATCHBYDEFAULT", "true")
            .WithEnvironment(
                "DIUN_NOTIF_WEBHOOK_ENDPOINT",
                ReferenceExpression.Create($"{notifier.Http}/diun"))
            .WithEnvironment("DIUN_NOTIF_WEBHOOK_METHOD", "POST")
            .WithBindMount(Path.Combine(context.Paths.Data, "diun"), "/data")
            .WithBindMount(
                context.Paths.ContainerSocket,
                "/var/run/docker.sock",
                isReadOnly: true)
            .WaitFor(notifier.Resource)
            .WithComposeRestart();
        return resource.Handle("diun");
    }

    public static ResourceHandle AddBootstrap(
        ArrspireContext context,
        ControlPlaneEndpoints endpoints)
    {
        var ports = Ingress.ResolvePorts(context.Paths.RootlessPodman);
        var resource = WithEndpointEnvironment(
            context,
            AddControlPlane(context, "bootstrap", "bootstrap")
                .WithEnvironment(
                    "QBITTORRENT_PASSWORD",
                    context.Parameters.QBittorrentPassword)
                .WithEnvironment("TRAEFIK_DOMAIN", context.Parameters.TraefikDomain)
                .WithEnvironment("TRAEFIK_TLS_MODE", context.Parameters.TraefikTlsMode)
                .WithEnvironment("TRAEFIK_HTTPS_PORT", ports.Https.ToString())
                .WithEnvironment("TRAEFIK_ACME_EMAIL", context.Parameters.TraefikAcmeEmail)
                .WithEnvironment(
                    "CF_DNS_API_TOKEN",
                    context.Parameters.CloudflareDnsApiToken)
                .WithEnvironment("INGRESS_ADMIN_USER", context.Parameters.IngressAdminUser)
                .WithEnvironment(
                    "INGRESS_ADMIN_PASSWORD",
                    context.Parameters.IngressAdminPassword)
                .WithEnvironment(
                    "AUTHELIA_SESSION_SECRET",
                    context.Parameters.AutheliaSessionSecret)
                .WithEnvironment(
                    "AUTHELIA_STORAGE_ENCRYPTION_KEY",
                    context.Parameters.AutheliaStorageEncryptionKey)
                .WithEnvironment("VPN_PROVIDER", context.Parameters.VpnProvider)
                .WithEnvironment(
                    "VPN_WIREGUARD_KEY",
                    context.Parameters.VpnWireguardKey)
                .WithEnvironment("VPN_COUNTRIES", context.Parameters.VpnCountries)
                .WithEnvironment("TIMEZONE", context.Parameters.Timezone)
                .WithEnvironment(
                    "JELLYFIN_LANGUAGE",
                    context.Parameters.JellyfinLanguage)
                .WithEnvironment(
                    "SUBTITLE_LANGUAGES",
                    context.Parameters.SubtitleLanguages)
                .WithEnvironment(
                    "USE_ORIGINAL_TITLE",
                    context.Parameters.UseOriginalTitle)
                .WithEnvironment("MINIMUM_SEEDERS", context.Parameters.MinimumSeeders)
                .WithOptionalProviderEnvironment(context),
            endpoints)
            .WithHiddenOnCompletion();
        return resource.Handle("bootstrap");
    }

    public static ResourceHandle AddReconciler(
        ArrspireContext context,
        ControlPlaneEndpoints endpoints,
        IEnumerable<IResourceBuilder<IResourceWithWaitSupport>> dependencies)
    {
        var resource = WithEndpointEnvironment(
            context,
            AddControlPlane(context, "reconciler", "reconcile")
                .WithEnvironment(
                    "JELLYFIN_ADMIN_USER",
                    context.Parameters.JellyfinAdminUser)
                .WithEnvironment(
                    "JELLYFIN_ADMIN_PASSWORD",
                    context.Parameters.JellyfinAdminPassword)
                .WithEnvironment(
                    "JELLYFIN_SERVER_NAME",
                    context.Parameters.JellyfinServerName)
                .WithEnvironment(
                    "JELLYFIN_LANGUAGE",
                    context.Parameters.JellyfinLanguage)
                .WithEnvironment(
                    "QBITTORRENT_PASSWORD",
                    context.Parameters.QBittorrentPassword)
                .WithEnvironment(
                    "DUPLICATI_WEB_PASSWORD",
                    context.Parameters.DuplicatiWebPassword)
                .WithEnvironment(
                    "DUPLICATI_ENCRYPTION_KEY",
                    context.Parameters.DuplicatiEncryptionKey)
                .WithEnvironment(
                    "SUBTITLE_LANGUAGES",
                    context.Parameters.SubtitleLanguages)
                .WithEnvironment(
                    "USE_ORIGINAL_TITLE",
                    context.Parameters.UseOriginalTitle)
                .WithEnvironment("MINIMUM_SEEDERS", context.Parameters.MinimumSeeders)
                .WithOptionalProviderEnvironment(context),
            endpoints);
        foreach (var dependency in dependencies)
        {
            resource.WaitFor(dependency);
        }

        resource
            .WithLifetime(ContainerLifetime.Session)
            .WithHealthCheck(ReconciliationHealth.CheckName)
            .WithComposeRestart("on-failure:5");
        return resource.Handle("reconciler");
    }

    public static ResourceHandle AddAcceptance(
        ArrspireContext context,
        ControlPlaneEndpoints endpoints,
        ResourceHandle reconciler,
        IEnumerable<IResourceBuilder<IResourceWithWaitSupport>> dependencies)
    {
        var resource = WithEndpointEnvironment(
            context,
            AddControlPlane(context, "acceptance", "verify")
                .WithEnvironment(
                    "JELLYFIN_ADMIN_USER",
                    context.Parameters.JellyfinAdminUser)
                .WithEnvironment(
                    "JELLYFIN_ADMIN_PASSWORD",
                    context.Parameters.JellyfinAdminPassword)
                .WithEnvironment(
                    "QBITTORRENT_PASSWORD",
                    context.Parameters.QBittorrentPassword),
            endpoints)
            .WaitForCompletion(reconciler.Resource)
            .WithLifetime(ContainerLifetime.Session);
        foreach (var dependency in dependencies)
        {
            resource.WaitFor(dependency);
        }

        return resource.Handle("acceptance");
    }

    private static IResourceBuilder<ContainerResource> AddControlPlane(
        ArrspireContext context,
        string name,
        string command,
        bool includeApplicationPaths = true)
    {
        var resource = context.Builder
            .AddDockerfile(
                name,
                context.SourceRoot,
                Path.Combine("control-plane", "Dockerfile"))
            .WithArgs(command)
            .WithBindMount(context.Paths.Data, "/data");
        if (includeApplicationPaths)
        {
            resource
                .WithBindMount(context.Paths.Media, "/media")
                .WithBindMount(context.Paths.Downloads, "/downloads");
        }

        return resource;
    }

    private static IResourceBuilder<ContainerResource> WithEndpointEnvironment(
        ArrspireContext context,
        IResourceBuilder<ContainerResource> resource,
        ControlPlaneEndpoints endpoints)
    {
        foreach (var (name, endpoint) in new Dictionary<string, EndpointReference>
        {
            ["GLUETUN_PROXY_URL"] = endpoints.GluetunProxy,
            ["INGRESS_URL"] = endpoints.Ingress,
            ["NOTIFIER_URL"] = endpoints.Notifier,
            ["SONARR_URL"] = endpoints.Sonarr,
            ["RADARR_URL"] = endpoints.Radarr,
            ["LIDARR_URL"] = endpoints.Lidarr,
            ["PROWLARR_URL"] = endpoints.Prowlarr,
            ["BAZARR_URL"] = endpoints.Bazarr,
            ["JELLYFIN_URL"] = endpoints.Jellyfin,
            ["SEERR_URL"] = endpoints.Seerr,
            ["QBITTORRENT_URL"] = endpoints.QBittorrent,
            ["TDARR_URL"] = endpoints.Tdarr,
            ["DUPLICATI_URL"] = endpoints.Duplicati,
            ["HOMEPAGE_URL"] = endpoints.Homepage,
            ["AUTH_URL"] = endpoints.Auth,
            ["PROMETHEUS_URL"] = endpoints.Prometheus,
            ["GRAFANA_URL"] = endpoints.Grafana,
        })
        {
            resource.WithEnvironment(name, endpoint);
        }

        var ports = Ingress.ResolvePorts(context.Paths.RootlessPodman);
        resource
            .WithEnvironment("TRAEFIK_DOMAIN", context.Parameters.TraefikDomain)
            .WithEnvironment("INGRESS_HTTPS_PORT", ports.Https.ToString());
        return resource;
    }

    private static IResourceBuilder<ContainerResource> WithOptionalProviderEnvironment(
        this IResourceBuilder<ContainerResource> resource,
        ArrspireContext context)
        => resource
            .WithEnvironment(
                "OPENSUBTITLESCOM_USER",
                context.Parameters.OpensubtitlesComUser)
            .WithEnvironment(
                "OPENSUBTITLESCOM_PASSWORD",
                context.Parameters.OpensubtitlesComPassword)
            .WithEnvironment(
                "OPENSUBTITLESORG_USER",
                context.Parameters.OpensubtitlesOrgUser)
            .WithEnvironment(
                "OPENSUBTITLESORG_PASSWORD",
                context.Parameters.OpensubtitlesOrgPassword)
            .WithEnvironment("LEGENDASDIVX_USER", context.Parameters.LegendasDivxUser)
            .WithEnvironment(
                "LEGENDASDIVX_PASSWORD",
                context.Parameters.LegendasDivxPassword)
            .WithEnvironment("LEGENDASNET_USER", context.Parameters.LegendasNetUser)
            .WithEnvironment(
                "LEGENDASNET_PASSWORD",
                context.Parameters.LegendasNetPassword);
}
