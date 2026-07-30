using Arrspire.AppHost;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Arrspire.AppHost.Tests;

public sealed class ReconciliationHealthTests
{
    [Theory]
    [InlineData("ready", HealthStatus.Healthy)]
    [InlineData("attention", HealthStatus.Healthy)]
    [InlineData("failed", HealthStatus.Unhealthy)]
    [InlineData("pending", HealthStatus.Unhealthy)]
    public void ReflectsPersistedReconciliationStatus(
        string status,
        HealthStatus expected)
    {
        var path = Path.GetTempFileName();
        try
        {
            File.WriteAllText(path, $$"""{"status":"{{status}}"}""");
            Assert.Equal(expected, ReconciliationHealth.Evaluate(path).Status);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void MissingStatusIsUnhealthy()
        => Assert.Equal(
            HealthStatus.Unhealthy,
            ReconciliationHealth.Evaluate(
                Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString())).Status);
}
