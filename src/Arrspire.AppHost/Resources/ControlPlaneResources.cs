using Aspire.Hosting.ApplicationModel;

namespace Arrspire.AppHost.Resources;

internal sealed record ControlPlaneEndpoints(
    EndpointReference GluetunProxy,
    EndpointReference Ingress,
    EndpointReference PublicIngress,
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
    EndpointReference Auth);

internal static class ControlPlaneResources
{
    public static HttpResourceHandle AddNotifier(
        ArrspireContext context,
        HttpResourceHandle homepage,
        EndpointReference publicIngress)
    {
        var configuredHttpsPort = Ingress.ResolvePorts(context.Paths.RootlessPodman).Https;
        var domain = context.Parameters.TraefikDomain;
        var statePath = context.IsRunMode
            ? Path.Combine(context.Paths.Data, "status", "notification-state.json")
            : "/data/status/notification-state.json";
        var resource = context.Builder
            .AddProject<Projects.Arrspire_Notifier>("notifier")
            .WithEnvironment("Notification__StatePath", statePath)
            .WithEnvironment("Ntfy__Endpoint", context.Parameters.NtfyEndpoint)
            .WithEnvironment("Ntfy__Topic", context.Parameters.NtfyTopic)
            .WithEnvironment("Ntfy__Token", context.Parameters.NtfyToken)
            .WithEnvironment(async environment =>
            {
                var domainValue = await domain.Resource.GetValueAsync(
                    environment.CancellationToken);
                var httpsPort = context.IsRunMode
                    ? await publicIngress
                        .Property(EndpointProperty.Port)
                        .GetValueAsync(environment.CancellationToken)
                        ?? throw new InvalidOperationException(
                            "Traefik public HTTPS endpoint port was not allocated")
                    : configuredHttpsPort.ToString();
                environment.EnvironmentVariables["Ntfy__Click"] =
                    $"https://{domainValue}"
                    + (httpsPort == "443" ? string.Empty : $":{httpsPort}");
            })
            .WaitFor(homepage.Resource)
            .WithHttpEndpoint(
                targetPort: 8080,
                name: "http",
                env: "ASPNETCORE_HTTP_PORTS")
            .WithHttpHealthCheck("/healthz")
            .PublishAsDockerFile(container => container
                .WithDockerfile(
                    context.SourceRoot,
                    Path.Combine("Arrspire.Notifier", "Dockerfile"))
                .WithBindMount(context.Paths.Data, "/data")
                .WithComposeHttpHealthCheck(8080, "/healthz")
                .WithComposeRestart());
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
        var resource = WithEndpointEnvironment(
            context,
            AddControlPlane(context, "bootstrap", "bootstrap")
                .WithEnvironment(
                    "Arrspire__QBittorrentPassword",
                    context.Parameters.QBittorrentPassword)
                .WithEnvironment("Arrspire__TraefikDomain", context.Parameters.TraefikDomain)
                .WithEnvironment("Arrspire__TraefikTlsMode", context.Parameters.TraefikTlsMode)
                .WithEnvironment("Arrspire__TraefikAcmeEmail", context.Parameters.TraefikAcmeEmail)
                .WithEnvironment(
                    "Arrspire__CloudflareDnsApiToken",
                    context.Parameters.CloudflareDnsApiToken)
                .WithEnvironment("Arrspire__IngressAdminUser", context.Parameters.IngressAdminUser)
                .WithEnvironment(
                    "Arrspire__IngressAdminPassword",
                    context.Parameters.IngressAdminPassword)
                .WithEnvironment(
                    "Arrspire__AutheliaSessionSecret",
                    context.Parameters.AutheliaSessionSecret)
                .WithEnvironment(
                    "Arrspire__AutheliaStorageEncryptionKey",
                    context.Parameters.AutheliaStorageEncryptionKey)
                .WithEnvironment("Arrspire__VpnProvider", context.Parameters.VpnProvider)
                .WithEnvironment(
                    "Arrspire__VpnWireguardKey",
                    context.Parameters.VpnWireguardKey)
                .WithEnvironment("Arrspire__VpnCountries", context.Parameters.VpnCountries)
                .WithEnvironment("Arrspire__Timezone", context.Parameters.Timezone)
                .WithEnvironment(
                    "Arrspire__JellyfinLanguage",
                    context.Parameters.JellyfinLanguage)
                .WithEnvironment(
                    "Arrspire__SubtitleLanguages",
                    context.Parameters.SubtitleLanguages)
                .WithEnvironment(
                    "Arrspire__UseOriginalTitle",
                    context.Parameters.UseOriginalTitle)
                .WithEnvironment("Arrspire__MinimumSeeders", context.Parameters.MinimumSeeders)
                .WithOptionalProviderEnvironment(context),
            endpoints)
            .WithPublicIngressPort(
                context,
                endpoints,
                "Arrspire__TraefikHttpsPort")
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
                    "Arrspire__JellyfinAdminUser",
                    context.Parameters.JellyfinAdminUser)
                .WithEnvironment(
                    "Arrspire__JellyfinAdminPassword",
                    context.Parameters.JellyfinAdminPassword)
                .WithEnvironment(
                    "Arrspire__JellyfinServerName",
                    context.Parameters.JellyfinServerName)
                .WithEnvironment(
                    "Arrspire__JellyfinLanguage",
                    context.Parameters.JellyfinLanguage)
                .WithEnvironment(
                    "Arrspire__QBittorrentPassword",
                    context.Parameters.QBittorrentPassword)
                .WithEnvironment(
                    "Arrspire__DuplicatiWebPassword",
                    context.Parameters.DuplicatiWebPassword)
                .WithEnvironment(
                    "Arrspire__DuplicatiEncryptionKey",
                    context.Parameters.DuplicatiEncryptionKey)
                .WithEnvironment(
                    "Arrspire__SubtitleLanguages",
                    context.Parameters.SubtitleLanguages)
                .WithEnvironment(
                    "Arrspire__UseOriginalTitle",
                    context.Parameters.UseOriginalTitle)
                .WithEnvironment("Arrspire__MinimumSeeders", context.Parameters.MinimumSeeders)
                .WithOptionalProviderEnvironment(context),
            endpoints);
        foreach (var dependency in dependencies)
        {
            resource.WaitFor(dependency);
        }

        resource
            .WithLifetime(ContainerLifetime.Session)
            .WithComposeHealthyDependencies(
                dependencies
                    .Select(dependency => dependency.Resource.Name)
                    .Where(name => name != "gluetun")
                    .ToArray())
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
                    "Arrspire__JellyfinAdminUser",
                    context.Parameters.JellyfinAdminUser)
                .WithEnvironment(
                    "Arrspire__JellyfinAdminPassword",
                    context.Parameters.JellyfinAdminPassword)
                .WithEnvironment(
                    "Arrspire__QBittorrentPassword",
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
            .WithOtlpExporter()
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
            ["Services__GluetunProxy"] = endpoints.GluetunProxy,
            ["Services__Ingress"] = endpoints.Ingress,
            ["Services__Notifier"] = endpoints.Notifier,
            ["Services__Sonarr"] = endpoints.Sonarr,
            ["Services__Radarr"] = endpoints.Radarr,
            ["Services__Lidarr"] = endpoints.Lidarr,
            ["Services__Prowlarr"] = endpoints.Prowlarr,
            ["Services__Bazarr"] = endpoints.Bazarr,
            ["Services__Jellyfin"] = endpoints.Jellyfin,
            ["Services__Seerr"] = endpoints.Seerr,
            ["Services__QBittorrent"] = endpoints.QBittorrent,
            ["Services__Tdarr"] = endpoints.Tdarr,
            ["Services__Duplicati"] = endpoints.Duplicati,
            ["Services__Homepage"] = endpoints.Homepage,
            ["Services__Auth"] = endpoints.Auth,
        })
        {
            resource
                .WithReference(endpoint)
                .WithEnvironment(name, endpoint);
        }

        resource
            .WithEnvironment("Arrspire__TraefikDomain", context.Parameters.TraefikDomain)
            .WithPublicIngressPort(
                context,
                endpoints,
                "Arrspire__IngressHttpsPort");
        return resource;
    }

    private static IResourceBuilder<ContainerResource> WithPublicIngressPort(
        this IResourceBuilder<ContainerResource> resource,
        ArrspireContext context,
        ControlPlaneEndpoints endpoints,
        string environmentName)
        => resource.WithEnvironment(async environment =>
        {
            var httpsPort = context.IsRunMode
                ? await endpoints.PublicIngress
                    .Property(EndpointProperty.Port)
                    .GetValueAsync(environment.CancellationToken)
                    ?? throw new InvalidOperationException(
                        "Ingress HTTPS endpoint port was not allocated")
                : Ingress.ResolvePorts(context.Paths.RootlessPodman).Https.ToString();
            environment.EnvironmentVariables[environmentName] = httpsPort;
        });

    private static IResourceBuilder<ContainerResource> WithOptionalProviderEnvironment(
        this IResourceBuilder<ContainerResource> resource,
        ArrspireContext context)
        => resource
            .WithEnvironment(
                "Arrspire__OpensubtitlesComUser",
                context.Parameters.OpensubtitlesComUser)
            .WithEnvironment(
                "Arrspire__OpensubtitlesComPassword",
                context.Parameters.OpensubtitlesComPassword)
            .WithEnvironment(
                "Arrspire__OpensubtitlesOrgUser",
                context.Parameters.OpensubtitlesOrgUser)
            .WithEnvironment(
                "Arrspire__OpensubtitlesOrgPassword",
                context.Parameters.OpensubtitlesOrgPassword)
            .WithEnvironment("Arrspire__LegendasDivxUser", context.Parameters.LegendasDivxUser)
            .WithEnvironment(
                "Arrspire__LegendasDivxPassword",
                context.Parameters.LegendasDivxPassword)
            .WithEnvironment("Arrspire__LegendasNetUser", context.Parameters.LegendasNetUser)
            .WithEnvironment(
                "Arrspire__LegendasNetPassword",
                context.Parameters.LegendasNetPassword);
}
