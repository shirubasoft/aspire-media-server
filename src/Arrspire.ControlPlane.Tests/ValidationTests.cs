namespace Arrspire.ControlPlane.Tests;

public sealed class ValidationTests
{
    [Fact]
    public void WireguardKeyRequiresExactly32Bytes()
    {
        Validation.ValidateWireguardKey(Convert.ToBase64String(new byte[32]));
        Assert.Throws<InvalidOperationException>(
            () => Validation.ValidateWireguardKey(Convert.ToBase64String(new byte[31])));
    }

    [Fact]
    public void FullConfigurationAcceptsSupportedValues()
        => Validation.ValidateConfiguration(ValidEnvironment());

    [Fact]
    public void OptionalCredentialsMustBePaired()
    {
        var environment = ValidEnvironment();
        environment["OPENSUBTITLESCOM_USER"] = "user";
        Assert.Throws<InvalidOperationException>(
            () => Validation.ValidateConfiguration(environment));
    }

    [Fact]
    public void CloudflareRequiresTokenAndEmail()
    {
        var environment = ValidEnvironment();
        environment["TRAEFIK_TLS_MODE"] = "cloudflare-acme";
        Assert.Throws<InvalidOperationException>(
            () => Validation.ValidateConfiguration(environment));
    }

    [Fact]
    public void OptionalCredentialStatesExplainSkippedProviders()
    {
        var state = Validation.OptionalCredentialStates(new Dictionary<string, string?>());
        Assert.Equal(4, state.Count);
        Assert.All(state, item => Assert.False(item.Configured));
        Assert.All(state, item => Assert.NotNull(item.Reason));
    }

    private static Dictionary<string, string?> ValidEnvironment()
        => new()
        {
            ["VPN_PROVIDER"] = "protonvpn",
            ["VPN_COUNTRIES"] = "Netherlands,United States",
            ["VPN_WIREGUARD_KEY"] = Convert.ToBase64String(new byte[32]),
            ["TIMEZONE"] = "UTC",
            ["JELLYFIN_LANGUAGE"] = "en-US",
            ["SUBTITLE_LANGUAGES"] = "en,pt-BR",
            ["MINIMUM_SEEDERS"] = "1",
            ["USE_ORIGINAL_TITLE"] = "false",
            ["TRAEFIK_DOMAIN"] = "192.168.0.15.nip.io",
            ["TRAEFIK_TLS_MODE"] = "local",
            ["INGRESS_ADMIN_USER"] = "admin",
            ["INGRESS_ADMIN_PASSWORD"] = "password",
            ["AUTHELIA_SESSION_SECRET"] = new string('a', 64),
            ["AUTHELIA_STORAGE_ENCRYPTION_KEY"] = new string('b', 64),
        };
}
