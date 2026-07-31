using Arrspire.AppHost;

namespace Arrspire.AppHost.Tests;

public sealed class IngressTests
{
    [Fact]
    public void UsesServerLanDomainByDefault()
        => Assert.Equal("192.168.0.15.nip.io", Ingress.DefaultTraefikDomain);

    [Fact]
    public void RootlessPodmanUsesUnprivilegedPorts()
        => Assert.Equal(
            new IngressPorts(8080, 8443),
            Ingress.ResolvePorts(true, new Dictionary<string, string?>()));

    [Fact]
    public void RootfulRuntimeUsesStandardPorts()
        => Assert.Equal(
            new IngressPorts(80, 443),
            Ingress.ResolvePorts(false, new Dictionary<string, string?>()));

    [Fact]
    public void ValidatesExplicitOverrides()
    {
        var environment = new Dictionary<string, string?>
        {
            ["ARRSPIRE_INGRESS_HTTP_PORT"] = "9080",
            ["ARRSPIRE_INGRESS_HTTPS_PORT"] = "9443",
        };
        Assert.Equal(new IngressPorts(9080, 9443), Ingress.ResolvePorts(true, environment));

        environment["ARRSPIRE_INGRESS_HTTP_PORT"] = "70000";
        Assert.Throws<InvalidOperationException>(() => Ingress.ResolvePorts(false, environment));
    }

    [Fact]
    public void ReadsPublishedHttpsPortAndBuildsPublicUrls()
    {
        const string compose = """
            services:
              traefik:
                image: traefik
                ports:
                  - "8080:80"
                  - "8443:443"
            """;

        Assert.Equal(8443, Ingress.PublishedTraefikHttpsPort(compose));
        Assert.Equal(
            "https://sonarr.192.168.0.15.nip.io:8443",
            Ingress.HttpsServiceUrl("sonarr", Ingress.DefaultTraefikDomain, 8443));
        Assert.Equal(":8443", Ingress.TraefikHttpsRedirectTarget(8443));
    }
}
