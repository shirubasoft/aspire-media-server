using System.Net;
using System.Net.Http.Json;
using Arrspire.Notifier.Hosting;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Arrspire.Notifier.Tests;

public sealed class NotifierEndpointTests : IClassFixture<NotifierApplication>
{
    private readonly HttpClient client;

    public NotifierEndpointTests(NotifierApplication application)
        => client = application.CreateClient();

    [Fact]
    public async Task HealthEndpointIsHealthy()
    {
        using var response = await client.GetAsync("/healthz");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task DiunWithoutConfiguredTopicDoesNotSend()
    {
        using var response = await client.PostAsJsonAsync("/diun", new
        {
            entry = new { image = "example/image:latest", status = "new" },
        });
        var delivery = await response.Content.ReadFromJsonAsync<Delivery>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull(delivery);
        Assert.False(delivery.Configured);
        Assert.False(delivery.Sent);
    }

    [Fact]
    public async Task ReconciliationWithoutConfiguredTopicPersistsNoNotificationState()
    {
        using var response = await client.PostAsJsonAsync("/reconciliation", new
        {
            results = Array.Empty<object>(),
        });
        var delivery = await response.Content.ReadFromJsonAsync<Delivery>();

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull(delivery);
        Assert.False(delivery.Configured);
        Assert.False(delivery.Sent);
    }

    [Fact]
    public async Task UnknownRouteIsNotFound()
    {
        using var response = await client.GetAsync("/not-an-endpoint");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    private sealed record Delivery(bool Configured, bool Sent, string Reason);
}

public sealed class NotifierApplication : WebApplicationFactory<NotifierAssemblyMarker>
{
    private readonly string statePath = Path.Combine(
        Path.GetTempPath(),
        $"arrspire-notifier-{Guid.NewGuid():N}.json");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
        => builder.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Notification:StatePath"] = statePath,
                ["Ntfy:Topic"] = string.Empty,
            }));

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (File.Exists(statePath))
        {
            File.Delete(statePath);
        }
    }
}
