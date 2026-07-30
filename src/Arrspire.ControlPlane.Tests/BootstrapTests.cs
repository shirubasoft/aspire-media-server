namespace Arrspire.ControlPlane.Tests;

public sealed class BootstrapTests
{
    [Fact]
    public void QBittorrentConfigContainsPbkdf2AndPaths()
    {
        var config = Bootstrap.QBittorrentConfiguration("secret");
        Assert.Contains("Password_PBKDF2=\"@ByteArray(", config);
        Assert.Contains("Session\\DefaultSavePath=/downloads", config);
        Assert.DoesNotContain("secret", config);
    }

    [Fact]
    public void ArrConfigUsesExpectedPortsAndUniqueApiKeys()
    {
        var first = Bootstrap.ArrConfiguration("sonarr", 8989);
        var second = Bootstrap.ArrConfiguration("sonarr", 8989);
        Assert.Contains("<Port>8989</Port>", first);
        Assert.Contains("<SslPort>8990</SslPort>", first);
        Assert.NotEqual(first, second);
    }

    [Fact]
    public void AutheliaDatabaseDoesNotExposePassword()
    {
        var database = Bootstrap.AutheliaUsersDatabase(
            "admin",
            "plain-password",
            new string('s', 64),
            "example.com");
        Assert.Contains("$pbkdf2-sha512$310000$", database);
        Assert.DoesNotContain("plain-password", database);
        Assert.Contains("arrspire@example.com", database);
    }

    [Theory]
    [InlineData("local", "tls: {}")]
    [InlineData("cloudflare-acme", "certResolver: letsencrypt")]
    public void TraefikConfigUsesSelectedTlsMode(string mode, string expected)
    {
        var config = Bootstrap.TraefikDynamicConfiguration(
            "example.com",
            new Dictionary<string, RoutedService>
            {
                ["sonarr"] = new("http://sonarr:8989", "ingress"),
                ["jellyfin"] = new("http://jellyfin:8096", "service"),
            },
            "http://authelia:9091",
            mode);
        Assert.Contains(expected, config);
        Assert.Contains("middlewares: [admin-auth]", config);
        Assert.Contains("http://jellyfin:8096", config);
    }

    [Fact]
    public void HomepageListsAllUserFacingGroups()
    {
        var services = new[]
        {
            "jellyfin", "seerr", "sonarr", "radarr", "lidarr", "prowlarr",
            "qbittorrent", "bazarr", "tdarr", "duplicati", "auth", "grafana",
            "prometheus", "aspire",
        }.ToDictionary(name => name, name => new RoutedService($"http://{name}", "service"));
        var config = Bootstrap.HomepageServices("example.com", 8443, services);
        Assert.Contains("Watch and Request", config);
        Assert.Contains("Library Automation", config);
        Assert.Contains("Downloads and Processing", config);
        Assert.Contains("Operations", config);
        Assert.Contains("https://jellyfin.example.com:8443", config);
        Assert.Contains("type: sonarr", config);
        Assert.Contains("{{HOMEPAGE_FILE_SONARR_KEY}}", config);
        Assert.Contains("{{HOMEPAGE_FILE_QBITTORRENT_PASSWORD}}", config);
        Assert.Contains(
            "siteMonitor: \"http://jellyfin/health\"\n    - Seerr:",
            config);
        Assert.Contains(
            "url: \"http://sonarr\"\n          key:",
            config);
    }

    [Fact]
    public void RuntimeDirectoryPlanPreservesLegacySeerrData()
    {
        var directory = Assert.Single(
            Bootstrap.RuntimeDirectories(),
            item => item.Path == "/data/jellyseerr");
        Assert.True(directory.Recursive);
        Assert.Equal((uint)1000, directory.Uid);
    }

    [Fact]
    public void RecyclarrConfigIncludesAnimeAndMovieProfiles()
    {
        var config = Recyclarr.Configuration("http://sonarr", "one", "http://radarr", "two");
        Assert.Contains("[Anime] Remux-1080p", config);
        Assert.Contains("d1d67249d3890e49bc12e275d989a7e9", config);
    }

    [Fact]
    public void PluginCleanupOnlyTargetsSupersededVersions()
    {
        var obsolete = PluginInstaller.ObsoleteDirectories(
            "Bazarr",
            "2.0",
            ["Bazarr_1.0", "Bazarr_2.0", "Other_1.0"]);
        Assert.Equal(["Bazarr_1.0"], obsolete);
    }
}
