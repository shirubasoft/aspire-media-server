using System.Net;
using System.Security.Cryptography.X509Certificates;

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

    [Fact]
    public void ComposeCommandsReuseTheResolvedAspireProject()
    {
        var arguments = DeploymentSupport.ComposeArguments(
            "aspire-arrspire-hash",
            "/output/.env.Production",
            "/output/docker-compose.yaml",
            ["down", "--remove-orphans"]);

        Assert.Equal(
            [
                "compose",
                "--project-name", "aspire-arrspire-hash",
                "--env-file", "/output/.env.Production",
                "--file", "/output/docker-compose.yaml",
                "down", "--remove-orphans",
            ],
            arguments);
    }

    [Fact]
    public async Task RuntimeDetectionContinuesWhenDockerIsMissing()
    {
        var runtime = await Deployment.FindRuntimeAsync(
            ["docker", "podman"],
            candidate => candidate == "docker"
                ? Task.FromException<bool>(new InvalidOperationException("missing"))
                : Task.FromResult(true));

        Assert.Equal("podman", runtime);
    }

    [Theory]
    [InlineData("999.999.999.999/24")]
    [InlineData("192.168.1.0/33")]
    [InlineData("2001:db8::/64")]
    public void FirewallRejectsInvalidIpv4Cidrs(string cidr)
        => Assert.Throws<InvalidOperationException>(
            () => Firewall.ValidateIpv4Cidr(cidr));

    [Fact]
    public void HomepageRedirectRequiresExactHttpsOriginAndRootPath()
    {
        Assert.True(DeploymentSupport.IsExpectedHomepageRedirect(
            HttpStatusCode.Redirect,
            new Uri("https://auth.example.com:8443/?rd=%2F"),
            "example.com",
            8443));
        Assert.False(DeploymentSupport.IsExpectedHomepageRedirect(
            HttpStatusCode.Redirect,
            new Uri("https://auth.example.com/"),
            "example.com",
            8443));
        Assert.False(DeploymentSupport.IsExpectedHomepageRedirect(
            HttpStatusCode.Redirect,
            new Uri("http://auth.example.com:8443/"),
            "example.com",
            8443));
        Assert.False(DeploymentSupport.IsExpectedHomepageRedirect(
            HttpStatusCode.Redirect,
            new Uri("https://auth.example.com:8443/wrong"),
            "example.com",
            8443));
    }

    [Fact]
    public void VpnCleanupTreatsMissingContainersAsIdempotent()
    {
        Assert.True(VpnCleanup.IsMissingContainer(
            "Error: No such container: arrspire-test-qbittorrent"));
        Assert.False(VpnCleanup.IsMissingContainer("permission denied"));
    }

    [Fact]
    public void DoctorClassifiesCapacityAndOptionalCredentialPairs()
    {
        Assert.Equal(
            DoctorCheckStatus.Fail,
            Doctor.DiskSpaceCheck("disk", 1024).Status);
        Assert.Equal(
            DoctorCheckStatus.Warn,
            Doctor.DiskSpaceCheck("disk", 5L * 1024 * 1024 * 1024).Status);
        Assert.Equal(
            "user",
            Doctor.BuildValidationEnvironment(new Dictionary<string, string>
            {
                ["opensubtitlescom-user"] = "user",
            })["OPENSUBTITLESCOM_USER"]);
    }

    [Fact]
    public void SetupConvertsWindowsTimezonesAndLocalTlsRejectsAcmeMode()
    {
        Assert.Equal(
            "America/Los_Angeles",
            Setup.DefaultTimezone("Pacific Standard Time"));
        Assert.Throws<InvalidOperationException>(
            () => LocalTls.ValidateMode("cloudflare-acme"));
    }

    [Fact]
    public void PublicationValidationIsServiceScoped()
    {
        var compose = ValidPublication();
        PublicationValidator.Validate(compose, 80, 443);

        Assert.Throws<InvalidOperationException>(() =>
            PublicationValidator.Validate(
                compose.Replace(
                    "      NTFY_TOKEN: \"${NTFY_TOKEN}\"",
                    "      NTFY_TOKEN: \"literal\"",
                    StringComparison.Ordinal),
                80,
                443));
        Assert.Throws<InvalidOperationException>(() =>
            PublicationValidator.Validate(
                compose.Replace(
                    "      NTFY_TOKEN: \"${NTFY_TOKEN}\"",
                    "      NTFY_TOKEN: \"${NTFY_TOKEN}\"\n"
                        + "      target: \"/media\"",
                    StringComparison.Ordinal),
                80,
                443));
        Assert.Throws<InvalidOperationException>(() =>
            PublicationValidator.Validate(
                compose.Replace(
                    "      ARRSPIRE_HOME_URL: \"https://example.com\"",
                    "      ARRSPIRE_HOME_URL: \"http://homepage:3000\"",
                    StringComparison.Ordinal),
                80,
                443));
        Assert.Throws<InvalidOperationException>(() =>
            PublicationValidator.Validate(
                compose.Replace(
                    "    ports:",
                    "    volumes:\n"
                        + "      - target: \"/etc/traefik/traefik.yml\"\n"
                        + "    ports:",
                    StringComparison.Ordinal),
                80,
                443));
    }

    [Fact]
    public void DeploymentArtifactsArePrivateFromCreation()
    {
        if (OperatingSystem.IsWindows())
        {
            return;
        }

        var root = Path.Combine(
            Path.GetTempPath(),
            $"arrspire-umask-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        var path = Path.Combine(root, ".env.Production");
        try
        {
            using (UnixPermissions.PrivateCreationScope())
            {
                File.WriteAllText(path, "SECRET=value\n");
            }
            Assert.Equal(
                UnixFileMode.UserRead | UnixFileMode.UserWrite,
                File.GetUnixFileMode(path));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task LocalTlsConfigurationProducesAUsableWildcardCertificate()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            $"arrspire-tls-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            var config = Path.Combine(root, "openssl.cnf");
            var key = Path.Combine(root, "tls.key");
            var request = Path.Combine(root, "tls.csr");
            var certificate = Path.Combine(root, "tls.crt");
            await File.WriteAllTextAsync(
                config,
                LocalTls.OpenSslConfiguration("example.com"),
                TestContext.Current.CancellationToken);

            Assert.Equal(
                0,
                await ProcessRunner.InheritAsync(
                    "openssl",
                    ["genrsa", "-out", key, "2048"],
                    root,
                    cancellationToken: TestContext.Current.CancellationToken));
            Assert.Equal(
                0,
                await ProcessRunner.InheritAsync(
                    "openssl",
                    ["req", "-new", "-key", key, "-out", request, "-config", config],
                    root,
                    cancellationToken: TestContext.Current.CancellationToken));
            Assert.Equal(
                0,
                await ProcessRunner.InheritAsync(
                    "openssl",
                    [
                        "x509", "-req", "-in", request, "-signkey", key,
                        "-out", certificate, "-days", "1", "-sha256",
                        "-extensions", "v3_req", "-extfile", config,
                    ],
                    root,
                    cancellationToken: TestContext.Current.CancellationToken));

            using var parsed =
                X509CertificateLoader.LoadCertificateFromFile(certificate);
            Assert.True(parsed.MatchesHostname(
                "example.com",
                allowWildcards: true,
                allowCommonName: true));
            Assert.True(parsed.MatchesHostname(
                "auth.example.com",
                allowWildcards: true,
                allowCommonName: true));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    private static string ValidPublication()
        => """
           services:
             traefik:
               environment:
                 TRAEFIK_API_INSECURE: "false"
                 TRAEFIK_ENTRYPOINTS_WEB_HTTP_REDIRECTIONS_ENTRYPOINT_SCHEME: "https"
                 TRAEFIK_ENTRYPOINTS_WEB_HTTP_REDIRECTIONS_ENTRYPOINT_TO: ":443"
                 CF_DNS_API_TOKEN: "${CLOUDFLARE_DNS_API_TOKEN}"
                 TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_STORAGE: "/acme/acme.json"
                 TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_DNSCHALLENGE: "true"
                 TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_DNSCHALLENGE_RESOLVERS: "1.1.1.1:53,8.8.8.8:53"
               ports:
                 - "80:80"
                 - "443:443"
             arrspire-dashboard:
               environment:
                 ASPIRE_DASHBOARD_FORWARDEDHEADERS_ENABLED: "true"
                 DOTNET_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS: "true"
             duplicati:
               environment:
                 DUPLICATI__WEBSERVICE_ALLOWED_HOSTNAMES: "*"
             authelia:
               environment:
                 AUTHELIA_SESSION_SECRET_FILE: "/secrets/session-secret"
                 AUTHELIA_STORAGE_ENCRYPTION_KEY_FILE: "/secrets/storage-encryption-key"
             diun:
               environment:
                 DIUN_NOTIF_WEBHOOK_ENDPOINT: "http://notifier:8080/diun"
             reconciler:
               environment:
                 NOTIFIER_URL: "http://notifier:8080"
             qbittorrent:
               network_mode: "service:gluetun"
             prowlarr:
               network_mode: "service:gluetun"
             homepage:
               environment:
                 HOMEPAGE_ALLOWED_HOSTS: "example.com"
               volumes:
                 - type: bind
                   target: "/app/config"
                   read_only: true
             notifier:
               environment:
                 NTFY_TOKEN: "${NTFY_TOKEN}"
                 ARRSPIRE_HOME_URL: "https://example.com"
             bootstrap:
               environment: {}
           """;
}
