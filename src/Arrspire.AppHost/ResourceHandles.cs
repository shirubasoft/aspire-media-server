using Aspire.Hosting.ApplicationModel;

namespace Arrspire.AppHost;

internal sealed record ResourceHandle(
    string Kind,
    IResourceBuilder<IResourceWithWaitSupport> Resource);

internal sealed record HttpResourceHandle(
    string Kind,
    IResourceBuilder<IResourceWithWaitSupport> Resource,
    EndpointReference Http);

internal sealed record ArrResourceHandle(
    string Kind,
    IResourceBuilder<IResourceWithWaitSupport> Resource,
    EndpointReference Http,
    string ApiVersion,
    string ConfigDirectory);

internal sealed record GluetunHandle(
    IResourceBuilder<ContainerResource> Container,
    IResourceBuilder<IResourceWithWaitSupport> Resource,
    EndpointReference Control,
    EndpointReference HttpProxy,
    EndpointReference QBittorrent,
    EndpointReference Prowlarr,
    string? RunContainerName,
    string? RunInstanceId);

internal sealed record VpnRoutedHandle(
    string Kind,
    IResourceBuilder<IResourceWithWaitSupport> Resource,
    IResourceBuilder<ContainerResource> ComposeResource,
    EndpointReference Http);

internal sealed record RecyclarrHandle(
    IResourceBuilder<IResourceWithWaitSupport> Resource,
    IResourceBuilder<ContainerResource> Container,
    IResourceBuilder<ContainerResource> Sync);

internal sealed record TdarrHandle(
    IResourceBuilder<IResourceWithWaitSupport> Resource,
    IResourceBuilder<ContainerResource> Container,
    EndpointReference WebUi,
    EndpointReference Server);

internal sealed record TraefikHandle(
    IResourceBuilder<IResourceWithWaitSupport> Resource,
    IResourceBuilder<ContainerResource> Container,
    EndpointReference Http,
    EndpointReference Https,
    EndpointReference PublicHttps,
    EndpointReference Dashboard);

internal static class ResourceHandleExtensions
{
    public static IResourceBuilder<IResourceWithWaitSupport> AsResource<T>(
        this IResourceBuilder<T> builder)
        where T : IResource, IResourceWithWaitSupport
        => builder.ApplicationBuilder.CreateResourceBuilder<IResourceWithWaitSupport>(
            builder.Resource);

    public static ResourceHandle Handle<T>(
        this IResourceBuilder<T> builder,
        string kind)
        where T : IResource, IResourceWithWaitSupport
        => new(kind, builder.AsResource());

    public static HttpResourceHandle HttpHandle<T>(
        this IResourceBuilder<T> builder,
        string kind,
        string endpointName = "http")
        where T : IResourceWithEndpoints, IResourceWithWaitSupport
        => new(kind, builder.AsResource(), builder.GetEndpoint(endpointName));
}
