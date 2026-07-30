using Arrspire.AppHost;
using Microsoft.Extensions.Configuration;

namespace Arrspire.AppHost.Tests;

public sealed class ArrspireParametersTests
{
    [Fact]
    public void MapsKebabCaseNamesToPortableEnvironmentNames()
    {
        var environment = new Dictionary<string, string?>
        {
            ["Parameters__traefik_domain"] = "home.example.com",
        };

        Assert.Equal(
            "home.example.com",
            ArrspireParameters.ParameterValue("traefik-domain", "fallback.example", environment));
    }

    [Fact]
    public void ReturnsFallbackWithoutDeploymentInput()
        => Assert.Equal(
            "local",
            ArrspireParameters.ParameterValue(
                "traefik-tls-mode",
                "local",
                new Dictionary<string, string?>()));

    [Fact]
    public void PreservesValuesFromTheAspireSecretStore()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Parameters:authelia-storage-encryption-key"] = "stable",
            })
            .Build();

        Assert.Equal(
            "stable",
            ArrspireParameters.ConfiguredValue(
                configuration,
                "authelia-storage-encryption-key",
                "generated",
                new Dictionary<string, string?>()));
    }

    [Fact]
    public void EnvironmentOverridesTheAspireSecretStore()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Parameters:timezone"] = "UTC",
            })
            .Build();
        var environment = new Dictionary<string, string?>
        {
            ["Parameters__timezone"] = "America/Sao_Paulo",
        };

        Assert.Equal(
            "America/Sao_Paulo",
            ArrspireParameters.ConfiguredValue(
                configuration,
                "timezone",
                "UTC",
                environment));
    }
}
