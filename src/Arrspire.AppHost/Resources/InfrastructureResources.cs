using Aspire.Hosting.ApplicationModel;

namespace Arrspire.AppHost.Resources;

internal static class InfrastructureResources
{
    public static HttpResourceHandle AddAuthelia(ArrspireContext context)
    {
        var resource = context.Builder
            .AddContainer("authelia", ArrspireImages.Authelia)
            .WithEnvironment("TZ", context.Parameters.Timezone)
            .WithEnvironment("AUTHELIA_SESSION_SECRET_FILE", "/secrets/session-secret")
            .WithEnvironment(
                "AUTHELIA_STORAGE_ENCRYPTION_KEY_FILE",
                "/secrets/storage-encryption-key")
            .WithBindMount(
                Path.Combine(context.Paths.Data, "authelia", "config"),
                "/config")
            .WithBindMount(
                Path.Combine(context.Paths.Data, "authelia", "secrets"),
                "/secrets",
                isReadOnly: true)
            .ExposeHttp(9091, "/api/health")
            .WithComposeInit()
            .WithComposeRestart();
        return resource.HttpHandle("authelia");
    }

    public static TraefikHandle AddTraefik(
        ArrspireContext context,
        HttpResourceHandle authelia)
    {
        var ports = Ingress.ResolvePorts(context.Paths.RootlessPodman);
        var resource = context.Builder
            .AddContainer("traefik", ArrspireImages.Traefik)
            .WithEnvironment("TRAEFIK_API_DASHBOARD", "true")
            .WithEnvironment("TRAEFIK_API_INSECURE", "false")
            .WithEnvironment("TRAEFIK_PING", "true")
            .WithEnvironment("TRAEFIK_ENTRYPOINTS_WEB_ADDRESS", ":80")
            .WithEnvironment("TRAEFIK_ENTRYPOINTS_WEBSECURE_ADDRESS", ":443")
            .WithEnvironment(
                "TRAEFIK_ENTRYPOINTS_WEB_HTTP_REDIRECTIONS_ENTRYPOINT_SCHEME",
                "https")
            .WithEnvironment(
                "TRAEFIK_PROVIDERS_FILE_DIRECTORY",
                "/etc/traefik/dynamic")
            .WithEnvironment("TRAEFIK_PROVIDERS_FILE_WATCH", "true")
            .WithEnvironment("TRAEFIK_ACCESSLOG", "true")
            .WithEnvironment(
                "TRAEFIK_ACCESSLOG_FILEPATH",
                "/var/log/traefik/access.log")
            .WithEnvironment("TRAEFIK_ACCESSLOG_FORMAT", "common")
            .WithEnvironment(
                "TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_EMAIL",
                context.Parameters.TraefikAcmeEmail)
            .WithEnvironment(
                "TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_STORAGE",
                "/acme/acme.json")
            .WithEnvironment(
                "TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_DNSCHALLENGE",
                "true")
            .WithEnvironment(
                "TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_DNSCHALLENGE_PROVIDER",
                "cloudflare")
            .WithEnvironment(
                "TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_DNSCHALLENGE_RESOLVERS",
                "1.1.1.1:53,8.8.8.8:53")
            .WithEnvironment("CF_DNS_API_TOKEN", context.Parameters.CloudflareDnsApiToken)
            .WithBindMount(
                Path.Combine(context.Paths.Data, "traefik", "dynamic"),
                "/etc/traefik/dynamic",
                isReadOnly: true)
            .WithBindMount(
                Path.Combine(context.Paths.Data, "traefik", "acme"),
                "/acme")
            .WithBindMount(
                Path.Combine(context.Paths.Data, "traefik", "logs"),
                "/var/log/traefik")
            .WaitFor(authelia.Resource)
            .WithEndpoint(
                port: ports.Http,
                targetPort: 80,
                scheme: "http",
                name: "http",
                isExternal: true)
            .WithEndpoint(
                port: ports.Https,
                targetPort: 443,
                scheme: "https",
                name: "https",
                isExternal: true)
            .WithEndpoint(
                targetPort: 8080,
                scheme: "http",
                name: "dashboard",
                isExternal: false)
            .WithHttpHealthCheck("/ping", endpointName: "dashboard");
        var publicHttps = resource.GetEndpoint(
            "https",
            KnownNetworkIdentifiers.LocalhostNetwork);
        resource
            .WithEnvironment(async environment =>
            {
                var httpsPort = context.IsRunMode
                    ? await publicHttps
                        .Property(EndpointProperty.Port)
                        .GetValueAsync(environment.CancellationToken)
                        ?? throw new InvalidOperationException(
                            "Traefik HTTPS endpoint port was not allocated")
                    : ports.Https.ToString();
                environment.EnvironmentVariables[
                    "TRAEFIK_ENTRYPOINTS_WEB_HTTP_REDIRECTIONS_ENTRYPOINT_TO"] =
                    $":{httpsPort}";
            })
            .WithComposeRestart();

        return new TraefikHandle(
            resource.AsResource(),
            resource,
            resource.GetEndpoint("http"),
            resource.GetEndpoint("https"),
            publicHttps,
            resource.GetEndpoint("dashboard"));
    }

    public static ResourceHandle AddFail2ban(
        ArrspireContext context,
        TraefikHandle traefik)
    {
        var resource = context.Builder
            .AddContainer("fail2ban", ArrspireImages.Fail2ban)
            .WithEnvironment("TZ", context.Parameters.Timezone)
            .WithEnvironment("F2B_LOG_TARGET", "STDOUT")
            .WithEnvironment("F2B_LOG_LEVEL", "INFO")
            .WithEnvironment("F2B_DB_PURGE_AGE", "7d")
            .WithBindMount(Path.Combine(context.Paths.Data, "fail2ban"), "/data")
            .WithBindMount(
                Path.Combine(context.Paths.Data, "traefik", "logs"),
                "/var/log/traefik",
                isReadOnly: true)
            .WaitFor(traefik.Resource)
            .WithComposeHostNetwork("NET_ADMIN", "NET_RAW");
        return resource.Handle("fail2ban");
    }

    public static HttpResourceHandle AddHomepage(
        ArrspireContext context,
        EndpointReference ingress)
    {
        var configuredHttpsPort = Ingress.ResolvePorts(context.Paths.RootlessPodman).Https;
        var domain = context.Parameters.TraefikDomain;
        var resource = context.Builder
            .AddContainer("homepage", ArrspireImages.Homepage)
            .WithEnvironment("LOG_TARGETS", "stdout")
            .WithEnvironment(async environment =>
            {
                var domainValue = await domain.Resource.GetValueAsync(
                    environment.CancellationToken);
                var httpsPort = context.IsRunMode
                    ? await ingress
                        .Property(EndpointProperty.Port)
                        .GetValueAsync(environment.CancellationToken)
                        ?? throw new InvalidOperationException(
                            "Traefik HTTPS endpoint port was not allocated")
                    : configuredHttpsPort.ToString();
                environment.EnvironmentVariables["HOMEPAGE_ALLOWED_HOSTS"] =
                    $"{domainValue},home.{domainValue},{domainValue}:{httpsPort},"
                    + $"home.{domainValue}:{httpsPort}";
            })
            .WithEnvironment(
                "HOMEPAGE_FILE_SONARR_KEY",
                "/app/config/secrets/sonarr-key")
            .WithEnvironment(
                "HOMEPAGE_FILE_RADARR_KEY",
                "/app/config/secrets/radarr-key")
            .WithEnvironment(
                "HOMEPAGE_FILE_LIDARR_KEY",
                "/app/config/secrets/lidarr-key")
            .WithEnvironment(
                "HOMEPAGE_FILE_PROWLARR_KEY",
                "/app/config/secrets/prowlarr-key")
            .WithEnvironment(
                "HOMEPAGE_FILE_QBITTORRENT_PASSWORD",
                "/app/config/secrets/qbittorrent-password")
            .WithBindMount(
                Path.Combine(context.Paths.Data, "homepage"),
                "/app/config",
                isReadOnly: true)
            .ExposeHttp(3000, "/")
            .WithComposeRestart();
        return resource.HttpHandle("homepage");
    }

}
