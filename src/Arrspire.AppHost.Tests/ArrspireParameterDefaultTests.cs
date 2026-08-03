using Arrspire.AppHost;

namespace Arrspire.AppHost.Tests;

public sealed class ArrspireParameterDefaultTests
{
    [Fact]
    public void VpnCountriesDefaultToTheVerifiedDeploymentRegion()
        => Assert.Equal("Brazil", ArrspireParameters.DefaultVpnCountries);

    [Fact]
    public void StaticDefaultReturnsConfiguredFallback()
        => Assert.Equal(
            "America/Sao_Paulo",
            new StaticParameterDefault("America/Sao_Paulo").GetDefaultValue());
}
