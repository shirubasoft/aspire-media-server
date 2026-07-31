using Arrspire.AppHost.Resources;
using Aspire.Hosting.ApplicationModel;

namespace Arrspire.AppHost;

internal sealed record ArrspireTopology(
    GluetunHandle Gluetun,
    VpnRoutedHandle QBittorrent,
    ArrResourceHandle Sonarr,
    ArrResourceHandle Radarr,
    ArrResourceHandle Lidarr,
    ArrResourceHandle Prowlarr,
    HttpResourceHandle Bazarr,
    HttpResourceHandle Jellyfin,
    HttpResourceHandle Seerr,
    RecyclarrHandle Recyclarr,
    HttpResourceHandle Duplicati,
    TdarrHandle Tdarr,
    HttpResourceHandle Authelia,
    TraefikHandle Traefik,
    ResourceHandle Fail2ban,
    ResourceHandle Diun,
    HttpResourceHandle Prometheus,
    HttpResourceHandle Grafana,
    HttpResourceHandle Homepage,
    HttpResourceHandle Notifier,
    ResourceHandle Bootstrap,
    ResourceHandle Reconciler,
    ResourceHandle? Acceptance);

internal static class ArrspireTopologyBuilder
{
    public static ArrspireTopology Add(ArrspireContext context)
    {
        var gluetun = VpnResources.AddGluetun(context);
        var qbittorrent = VpnResources.AddQBittorrent(context, gluetun);
        var prowlarr = VpnResources.AddProwlarr(context, gluetun);
        var sonarr = MediaResources.AddSonarr(context);
        var radarr = MediaResources.AddRadarr(context);
        var lidarr = MediaResources.AddLidarr(context);
        var bazarr = MediaResources.AddBazarr(context);
        var jellyfin = MediaResources.AddJellyfin(context);
        var seerr = MediaResources.AddSeerr(context);
        var recyclarr = MediaResources.AddRecyclarr(context);
        var duplicati = MediaResources.AddDuplicati(context);
        var tdarr = MediaResources.AddTdarr(context);
        var authelia = InfrastructureResources.AddAuthelia(context);
        var traefik = InfrastructureResources.AddTraefik(context, authelia);
        var fail2ban = InfrastructureResources.AddFail2ban(context, traefik);
        var prometheus = InfrastructureResources.AddPrometheus(context);
        var grafana = InfrastructureResources.AddGrafana(context, prometheus);
        var homepage = InfrastructureResources.AddHomepage(context, traefik.PublicHttps);
        var notifier = ControlPlaneResources.AddNotifier(
            context,
            homepage,
            traefik.PublicHttps);
        var diun = ControlPlaneResources.AddDiun(context, notifier);

        var endpoints = new ControlPlaneEndpoints(
            gluetun.HttpProxy,
            traefik.Https,
            traefik.PublicHttps,
            notifier.Http,
            sonarr.Http,
            radarr.Http,
            lidarr.Http,
            prowlarr.Http,
            bazarr.Http,
            jellyfin.Http,
            seerr.Http,
            qbittorrent.Http,
            tdarr.WebUi,
            duplicati.Http,
            homepage.Http,
            authelia.Http,
            prometheus.Http,
            grafana.Http);
        var bootstrap = ControlPlaneResources.AddBootstrap(context, endpoints);

        var bootstrappedResources = new IResourceBuilder<IResourceWithWaitSupport>[]
        {
            gluetun.Resource,
            qbittorrent.Resource,
            sonarr.Resource,
            radarr.Resource,
            lidarr.Resource,
            prowlarr.Resource,
            bazarr.Resource,
            jellyfin.Resource,
            seerr.Resource,
            recyclarr.Resource,
            duplicati.Resource,
            tdarr.Resource,
            authelia.Resource,
            traefik.Resource,
            fail2ban.Resource,
            diun.Resource,
            prometheus.Resource,
            grafana.Resource,
            homepage.Resource,
            notifier.Resource,
        };
        foreach (var resource in bootstrappedResources)
        {
            resource.WaitForCompletion(bootstrap.Resource);
        }

        recyclarr.Sync.WaitFor(sonarr.Resource).WaitFor(radarr.Resource);
        var reconciledResources = new IResourceBuilder<IResourceWithWaitSupport>[]
        {
            gluetun.Resource,
            qbittorrent.Resource,
            sonarr.Resource,
            radarr.Resource,
            lidarr.Resource,
            prowlarr.Resource,
            bazarr.Resource,
            jellyfin.Resource,
            seerr.Resource,
            tdarr.Resource,
            authelia.Resource,
            notifier.Resource,
        };
        var reconciler = ControlPlaneResources.AddReconciler(
            context,
            endpoints,
            reconciledResources);
        reconciler.Resource.WaitFor(recyclarr.Sync);
        recyclarr.Container.WaitForCompletion(reconciler.Resource);

        ResourceHandle? acceptance = null;
        if (string.Equals(
            Environment.GetEnvironmentVariable("ARRSPIRE_E2E"),
            "true",
            StringComparison.OrdinalIgnoreCase))
        {
            acceptance = ControlPlaneResources.AddAcceptance(
                context,
                endpoints,
                reconciler,
                [.. reconciledResources, homepage.Resource]);
        }

        return new(
            gluetun,
            qbittorrent,
            sonarr,
            radarr,
            lidarr,
            prowlarr,
            bazarr,
            jellyfin,
            seerr,
            recyclarr,
            duplicati,
            tdarr,
            authelia,
            traefik,
            fail2ban,
            diun,
            prometheus,
            grafana,
            homepage,
            notifier,
            bootstrap,
            reconciler,
            acceptance);
    }
}
