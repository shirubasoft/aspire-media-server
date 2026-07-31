using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Docker.Resources.ComposeNodes;
using Aspire.Hosting.Docker.Resources.ServiceNodes;

namespace Arrspire.AppHost;

internal static class ArrspireResourceExtensions
{
    public static IResourceBuilder<ContainerResource> WithLinuxServerDefaults(
        this IResourceBuilder<ContainerResource> resource,
        ArrspireContext context)
    {
        resource
            .WithEnvironment("PUID", UnixIdentity.UserId.ToString())
            .WithEnvironment("PGID", UnixIdentity.GroupId.ToString())
            .WithEnvironment("TZ", context.Parameters.Timezone);

        if (context.Paths.RootlessPodman)
        {
            resource.WithContainerRuntimeArgs("--userns=keep-id");
        }

        return resource;
    }

    public static IResourceBuilder<ContainerResource> ExposeHttp(
        this IResourceBuilder<ContainerResource> resource,
        int port,
        string healthPath,
        string endpointName = "http")
    {
        var directAccess = DirectHostAccessEnabled();
        resource
            .WithEndpoint(
                port: directAccess ? port : null,
                targetPort: port,
                scheme: "http",
                name: endpointName,
                isExternal: directAccess)
            .WithHttpHealthCheck(healthPath, endpointName: endpointName)
            .WithComposeHttpHealthCheck(port, healthPath);
        return resource;
    }

    public static bool DirectHostAccessEnabled()
        => string.Equals(
            Environment.GetEnvironmentVariable("ARRSPIRE_EXPOSE_DIRECT_PORTS"),
            "true",
            StringComparison.OrdinalIgnoreCase);

    public static IResourceBuilder<T> WithComposeRestart<T>(
        this IResourceBuilder<T> resource,
        string policy = "unless-stopped")
        where T : IComputeResource
        => resource.PublishAsDockerComposeService((_, service) => service.Restart = policy);

    public static IResourceBuilder<T> WithComposeHttpHealthCheck<T>(
        this IResourceBuilder<T> resource,
        int port,
        string path)
        where T : IComputeResource
        => resource.PublishAsDockerComposeService((_, service) =>
            service.Healthcheck = new Healthcheck
            {
                Test =
                [
                    "CMD-SHELL",
                    $"if command -v curl >/dev/null; then curl -fsS http://127.0.0.1:{port}{path} >/dev/null; "
                    + $"else wget -q -O /dev/null http://127.0.0.1:{port}{path}; fi",
                ],
                Interval = "5s",
                Timeout = "3s",
                Retries = 24,
                StartPeriod = "5s",
            });

    public static IResourceBuilder<T> WithComposeHealthyDependencies<T>(
        this IResourceBuilder<T> resource,
        params string[] dependencies)
        where T : IComputeResource
        => resource.PublishAsDockerComposeService((_, service) =>
        {
            foreach (var dependency in dependencies)
            {
                service.DependsOn[dependency] = new ServiceDependency
                {
                    Condition = "service_healthy",
                };
            }
        });

    public static IResourceBuilder<T> WithComposeInit<T>(this IResourceBuilder<T> resource)
        where T : IComputeResource
        => resource.PublishAsDockerComposeService((_, service) => service.Init = true);

    public static IResourceBuilder<ContainerResource> ConfigureComposeVpnNetwork(
        this IResourceBuilder<ContainerResource> resource,
        GluetunHandle gluetun)
        => resource.PublishAsDockerComposeService((_, service) =>
        {
            service.NetworkMode = $"service:{gluetun.Resource.Resource.Name}";
            service.Ports.Clear();
            service.Networks.Clear();
            service.Restart = "unless-stopped";
        });

    public static IResourceBuilder<ContainerResource> WithComposeHostNetwork(
        this IResourceBuilder<ContainerResource> resource,
        params string[] capabilities)
        => resource.PublishAsDockerComposeService((_, service) =>
        {
            foreach (var capability in capabilities)
            {
                service.CapAdd.Add(capability);
            }

            service.NetworkMode = "host";
            service.Networks.Clear();
            service.Restart = "unless-stopped";
        });
}

internal sealed record ArrspireContext(
    IDistributedApplicationBuilder Builder,
    ArrspireParameters Parameters,
    ArrspirePaths Paths,
    bool IsRunMode)
{
    public string SourceRoot => Path.GetFullPath(Path.Combine(Builder.AppHostDirectory, ".."));
}
