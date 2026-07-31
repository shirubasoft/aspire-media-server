namespace Arrspire.ControlPlane.Tests;

public sealed class ControlPlaneOptionsTests
{
    [Fact]
    public void ReconcileOptionsRejectMissingRequiredSecret()
    {
        var options = ValidReconcileOptions() with
        {
            QBittorrentPassword = string.Empty,
        };

        var result = new ControlPlaneOptionsValidator(ControlPlaneMode.Reconcile)
            .Validate(null, options);

        Assert.True(result.Failed);
        Assert.Contains(nameof(options.QBittorrentPassword), result.FailureMessage);
    }

    [Fact]
    public void ReconcileOptionsRejectNegativeMinimumSeeders()
    {
        var options = ValidReconcileOptions() with { MinimumSeeders = -1 };

        var result = new ControlPlaneOptionsValidator(ControlPlaneMode.Reconcile)
            .Validate(null, options);

        Assert.True(result.Failed);
        Assert.Contains(nameof(options.MinimumSeeders), result.FailureMessage);
    }

    [Fact]
    public void EndpointOptionsRequireAbsoluteUris()
    {
        var endpoints = ValidEndpoints() with { Sonarr = "sonarr" };

        var result = new ServiceEndpointOptionsValidator(ControlPlaneMode.Reconcile)
            .Validate(null, endpoints);

        Assert.True(result.Failed);
    }

    [Fact]
    public void ValidReconcileConfigurationPassesOptionsValidation()
    {
        var optionsResult = new ControlPlaneOptionsValidator(ControlPlaneMode.Reconcile)
            .Validate(null, ValidReconcileOptions());
        var endpointResult = new ServiceEndpointOptionsValidator(ControlPlaneMode.Reconcile)
            .Validate(null, ValidEndpoints());

        Assert.True(optionsResult.Succeeded);
        Assert.True(endpointResult.Succeeded);
    }

    private static ControlPlaneOptions ValidReconcileOptions() => new()
    {
        QBittorrentPassword = "secret",
        JellyfinAdminUser = "admin",
        JellyfinAdminPassword = "secret",
        JellyfinServerName = "arrspire",
        JellyfinLanguage = "pt-BR",
        DuplicatiWebPassword = "secret",
        DuplicatiEncryptionKey = "secret",
        SubtitleLanguages = "pt-BR",
        TraefikDomain = "example.com",
        MinimumSeeders = 1,
    };

    private static ServiceEndpointOptions ValidEndpoints() => new()
    {
        GluetunProxy = "http://gluetun:8888",
        Sonarr = "http://sonarr:8989",
        Radarr = "http://radarr:7878",
        Lidarr = "http://lidarr:8686",
        Prowlarr = "http://prowlarr:9696",
        Bazarr = "http://bazarr:6767",
        Jellyfin = "http://jellyfin:8096",
        Seerr = "http://seerr:5055",
        QBittorrent = "http://qbittorrent:8080",
        Tdarr = "http://tdarr:8265",
        Duplicati = "http://duplicati:8200",
    };
}
