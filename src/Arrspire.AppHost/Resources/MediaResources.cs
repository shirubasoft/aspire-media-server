using Aspire.Hosting.ApplicationModel;

namespace Arrspire.AppHost.Resources;

internal static class MediaResources
{
    public static ArrResourceHandle AddSonarr(ArrspireContext context)
        => AddArr(context, "sonarr", ArrspireImages.Sonarr, 8989, "tv", "v3");

    public static ArrResourceHandle AddRadarr(ArrspireContext context)
        => AddArr(context, "radarr", ArrspireImages.Radarr, 7878, "movies", "v3");

    public static ArrResourceHandle AddLidarr(ArrspireContext context)
        => AddArr(context, "lidarr", ArrspireImages.Lidarr, 8686, "music", "v1");

    public static HttpResourceHandle AddBazarr(ArrspireContext context)
    {
        var resource = context.Builder
            .AddContainer("bazarr", ArrspireImages.Bazarr)
            .WithBindMount(Path.Combine(context.Paths.Data, "bazarr"), "/config")
            .WithBindMount(Path.Combine(context.Paths.Media, "movies"), "/movies")
            .WithBindMount(Path.Combine(context.Paths.Media, "tv"), "/tv")
            .WithLinuxServerDefaults(context)
            .ExposeHttp(6767, "/")
            .WithComposeRestart();
        return resource.HttpHandle("bazarr");
    }

    public static HttpResourceHandle AddJellyfin(ArrspireContext context)
    {
        var resource = context.Builder
            .AddContainer("jellyfin", ArrspireImages.Jellyfin)
            .WithEnvironment("TZ", context.Parameters.Timezone)
            .WithBindMount(Path.Combine(context.Paths.Data, "jellyfin"), "/config")
            .WithBindMount(Path.Combine(context.Paths.Data, "jellyfin-cache"), "/cache")
            .WithBindMount(context.Paths.Media, "/media")
            .ExposeHttp(8096, "/health")
            .WithComposeRestart();
        return resource.HttpHandle("jellyfin");
    }

    public static HttpResourceHandle AddSeerr(ArrspireContext context)
    {
        var resource = context.Builder
            .AddContainer("seerr", ArrspireImages.Seerr)
            .WithContainerRuntimeArgs("--init")
            .WithEnvironment("TZ", context.Parameters.Timezone)
            .WithBindMount(Path.Combine(context.Paths.Data, "jellyseerr"), "/app/config")
            .ExposeHttp(5055, "/api/v1/status")
            .WithComposeInit()
            .WithComposeRestart();
        return resource.HttpHandle("seerr");
    }

    public static HttpResourceHandle AddDuplicati(ArrspireContext context)
    {
        var resource = context.Builder
            .AddContainer("duplicati", ArrspireImages.Duplicati)
            .WithContainerRuntimeArgs("--restart=on-failure:3")
            .WithEnvironment("TZ", context.Parameters.Timezone)
            .WithEnvironment(
                "DUPLICATI__SETTINGS_ENCRYPTION_KEY",
                context.Parameters.DuplicatiEncryptionKey)
            .WithEnvironment(
                "DUPLICATI__WEBSERVICE_PASSWORD",
                context.Parameters.DuplicatiWebPassword)
            .WithEnvironment("DUPLICATI__WEBSERVICE_ALLOWED_HOSTNAMES", "*")
            .WithBindMount(Path.Combine(context.Paths.Data, "duplicati"), "/data")
            .WithBindMount(Path.Combine(context.Paths.Data, "backups"), "/backups");

        foreach (var source in BackupSources)
        {
            resource.WithBindMount(
                Path.Combine(context.Paths.Data, source),
                $"/source/{source}",
                isReadOnly: true);
        }

        resource.ExposeHttp(8200, "/").WithComposeRestart();
        return resource.HttpHandle("duplicati");
    }

    public static TdarrHandle AddTdarr(ArrspireContext context)
    {
        var directAccess = ArrspireResourceExtensions.DirectHostAccessEnabled();
        var resource = context.Builder
            .AddContainer("tdarr", ArrspireImages.Tdarr)
            .WithEnvironment("TZ", context.Parameters.Timezone)
            .WithEnvironment("PUID", UnixIdentity.UserId.ToString())
            .WithEnvironment("PGID", UnixIdentity.GroupId.ToString())
            .WithEnvironment("UMASK_SET", "002")
            .WithEnvironment("serverIP", "0.0.0.0")
            .WithEnvironment("serverPort", "8266")
            .WithEnvironment("webUIPort", "8265")
            .WithEnvironment("internalNode", "true")
            .WithEnvironment("inContainer", "true")
            .WithEnvironment("ffmpegVersion", "7")
            .WithEnvironment("nodeName", "InternalNode")
            .WithBindMount(Path.Combine(context.Paths.Data, "tdarr", "server"), "/app/server")
            .WithBindMount(Path.Combine(context.Paths.Data, "tdarr", "configs"), "/app/configs")
            .WithBindMount(Path.Combine(context.Paths.Data, "tdarr", "logs"), "/app/logs")
            .WithBindMount(
                Path.Combine(context.Paths.Data, "tdarr", "transcode-cache"),
                "/temp")
            .WithBindMount(context.Paths.Media, "/media")
            .WithEndpoint(
                port: directAccess ? 8265 : null,
                targetPort: 8265,
                scheme: "http",
                name: "webui",
                isExternal: directAccess)
            .WithEndpoint(
                port: directAccess ? 8266 : null,
                targetPort: 8266,
                scheme: "http",
                name: "server",
                isExternal: directAccess)
            .WithHttpHealthCheck("/api/v2/status", endpointName: "webui");
        resource.WithComposeRestart();

        return new TdarrHandle(
            resource.AsResource(),
            resource,
            resource.GetEndpoint("webui"),
            resource.GetEndpoint("server"));
    }

    public static RecyclarrHandle AddRecyclarr(ArrspireContext context)
    {
        var configDirectory = Path.Combine(context.Paths.Data, "recyclarr");
        var sync = context.Builder
            .AddContainer("recyclarr-sync", ArrspireImages.Recyclarr)
            .WithEntrypoint("/bin/bash")
            .WithArgs(
                "-c",
                "set -euo pipefail; /app/recyclarr/recyclarr sync; "
                + "printf '%s\\n' '#!/bin/sh' "
                + "'printf \"HTTP/1.1 200 OK\\r\\nContent-Length: 5\\r\\n"
                + "Connection: close\\r\\n\\r\\nready\"' > /tmp/recyclarr-health; "
                + "chmod +x /tmp/recyclarr-health; "
                + "exec /usr/bin/nc -lk -p 8787 -e /tmp/recyclarr-health")
            .WithEnvironment("TZ", context.Parameters.Timezone)
            .WithBindMount(configDirectory, "/config")
            .WithEndpoint(targetPort: 8787, scheme: "http", name: "health")
            .WithHttpHealthCheck("/", endpointName: "health");
        var scheduled = context.Builder
            .AddContainer("recyclarr", ArrspireImages.Recyclarr)
            .WithEnvironment("TZ", context.Parameters.Timezone)
            .WithEnvironment("CRON_SCHEDULE", "@daily")
            .WithBindMount(configDirectory, "/config")
            .WithComposeRestart();

        return new RecyclarrHandle(scheduled.AsResource(), scheduled, sync);
    }

    private static ArrResourceHandle AddArr(
        ArrspireContext context,
        string name,
        string image,
        int port,
        string mediaDirectory,
        string apiVersion)
    {
        var resource = context.Builder
            .AddContainer(name, image)
            .WithBindMount(Path.Combine(context.Paths.Data, name), "/config")
            .WithBindMount(
                Path.Combine(context.Paths.Media, mediaDirectory),
                $"/{mediaDirectory}")
            .WithBindMount(context.Paths.Downloads, "/downloads")
            .WithLinuxServerDefaults(context)
            .ExposeHttp(port, "/ping")
            .WithComposeRestart();
        return new ArrResourceHandle(
            name,
            resource.AsResource(),
            resource.GetEndpoint("http"),
            apiVersion,
            $"/data/{name}");
    }

    private static readonly string[] BackupSources =
    [
        "authelia",
        "sonarr",
        "radarr",
        "lidarr",
        "prowlarr",
        "bazarr",
        "jellyfin",
        "jellyseerr",
        "qbittorrent",
        "gluetun",
    ];
}
