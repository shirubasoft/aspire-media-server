namespace Arrspire.Operator.Tests;

public sealed class OperatorTests
{
    [Fact]
    public void FirewallFindsLanCidrOnDefaultInterface()
    {
        var routes = """
                     default via 192.168.1.1 dev enp4s0 proto dhcp
                     172.17.0.0/16 dev docker0 scope link
                     192.168.1.0/24 dev enp4s0 proto kernel scope link
                     """;
        Assert.Equal("192.168.1.0/24", Firewall.LanIpv4Cidr(routes));
    }

    [Theory]
    [InlineData("      - 0.0.0.0:8443:443", 8443)]
    [InlineData("      - 127.0.0.1:443:443", 443)]
    [InlineData("      - '[::]:9443:443'", 9443)]
    public void FirewallReadsPublishedHttpsPort(string compose, int expected)
        => Assert.Equal(expected, Firewall.PublishedHttpsPort(compose));

    [Fact]
    public void LocalTlsConfigurationIncludesRootAndWildcard()
    {
        var configuration = LocalTls.OpenSslConfiguration("example.com");
        Assert.Contains("DNS.1 = *.example.com", configuration);
        Assert.Contains("DNS.2 = example.com", configuration);
        Assert.Contains("auth.example.com", configuration);
        Assert.Contains("seerr.example.com", configuration);
    }

    [Theory]
    [InlineData("Upper.example.com")]
    [InlineData("-example.com")]
    [InlineData("example com")]
    public void LocalTlsRejectsUnsafeDomains(string domain)
        => Assert.Throws<InvalidOperationException>(
            () => LocalTls.ValidateDomain(domain));

    [Fact]
    public void PublicationAllowsOnlyTraefikPorts()
    {
        const string compose = """
            services:
              sonarr:
                expose:
                  - "8989"
              traefik:
                ports:
                  - "80:80"
                  - "443:443"
            """;
        var ports = PublicationValidator.PublishedPorts(compose);
        var published = Assert.Single(ports);
        Assert.Equal("traefik", published.Key);
        Assert.Equal(["80:80", "443:443"], published.Value);
    }

    [Fact]
    public void ComposeProjectSelectionUsesExactComposeFile()
    {
        var compose = Path.GetFullPath("/tmp/arrspire/docker-compose.yaml");
        var document = $$"""
            warning before json
            [{"Name":"arrspire","ConfigFiles":["{{compose}}"]}]
            """;
        Assert.Equal(
            "arrspire",
            DeploymentSupport.SelectComposeProjectName(document, compose));
    }

    [Fact]
    public void PodmanRecoveryIsProjectScoped()
    {
        const string containers = """
            [
              {"Id":"qbit","Labels":{"com.docker.compose.project":"arrspire","com.docker.compose.service":"qbittorrent"}},
              {"Id":"vpn","Labels":{"com.docker.compose.project":"arrspire","com.docker.compose.service":"gluetun"}},
              {"Id":"other","Labels":{"com.docker.compose.project":"else","com.docker.compose.service":"gluetun"}}
            ]
            """;
        var plan = Assert.IsType<PodmanRecovery>(
            DeploymentSupport.PodmanRecoveryPlan(containers, "arrspire"));
        Assert.Equal(["qbit"], plan.Dependents);
        Assert.Equal(["vpn"], plan.Infrastructure);
    }
}
