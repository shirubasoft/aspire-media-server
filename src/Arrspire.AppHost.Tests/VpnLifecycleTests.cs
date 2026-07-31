namespace Arrspire.AppHost.Tests;

public sealed class VpnLifecycleTests
{
    [Fact]
    public void WrapperExitRemovesOnlyItsVpnRoutedContainer()
    {
        var step = VpnContainerRunner.CleanupStep(
            appHostAlive: true,
            wrapperAlive: false,
            wrapperCleaned: false,
            "qbittorrent",
            "gluetun");

        Assert.True(step.WrapperCleaned);
        Assert.Equal(["qbittorrent"], step.Containers);
    }

    [Fact]
    public void AbruptAppHostExitRemovesDependentAndGluetunContainers()
    {
        var step = VpnContainerRunner.CleanupStep(
            appHostAlive: false,
            wrapperAlive: false,
            wrapperCleaned: false,
            "prowlarr",
            "gluetun");

        Assert.True(step.WrapperCleaned);
        Assert.Equal(["prowlarr", "gluetun"], step.Containers);
    }
}
