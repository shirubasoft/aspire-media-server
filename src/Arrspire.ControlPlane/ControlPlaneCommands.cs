using System.CommandLine;
using System.Net;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Arrspire.ControlPlane;

internal static class ControlPlaneCommands
{
    public static RootCommand CreateRootCommand()
    {
        var root = new RootCommand("Arrspire one-shot control-plane operations");
        root.Subcommands.Add(Command("bootstrap", ControlPlaneMode.Bootstrap, (services, token) =>
            Bootstrap.RunAsync(
                services.GetRequiredService<IOptions<ControlPlaneOptions>>().Value,
                services.GetRequiredService<IOptions<ServiceEndpointOptions>>().Value,
                services.GetRequiredService<IHttpClientFactory>(),
                services.GetRequiredService<ILoggerFactory>()
                    .CreateLogger("Arrspire.ControlPlane.Bootstrap"),
                token)));
        root.Subcommands.Add(Command("reconcile", ControlPlaneMode.Reconcile, (services, token) =>
            Reconciler.RunAsync(
                services.GetRequiredService<IOptions<ControlPlaneOptions>>().Value,
                services.GetRequiredService<IOptions<ServiceEndpointOptions>>().Value,
                services.GetRequiredService<IHttpClientFactory>(),
                services.GetRequiredService<ILoggerFactory>()
                    .CreateLogger("Arrspire.ControlPlane.Reconciler"),
                token)));
        root.Subcommands.Add(Command("verify", ControlPlaneMode.Verify, (services, token) =>
            Acceptance.VerifyAsync(
                services.GetRequiredService<IOptions<ControlPlaneOptions>>().Value,
                services.GetRequiredService<IOptions<ServiceEndpointOptions>>().Value,
                services.GetRequiredService<IHttpClientFactory>(),
                services.GetRequiredService<ILoggerFactory>()
                    .CreateLogger("Arrspire.ControlPlane.Acceptance"),
                token)));
        return root;
    }

    private static Command Command(
        string name,
        ControlPlaneMode mode,
        Func<IServiceProvider, CancellationToken, Task> operation)
    {
        var command = new Command(name);
        command.SetAction(async (_, cancellationToken) =>
        {
            var builder = Host.CreateApplicationBuilder();
            builder.AddServiceDefaults();
            builder.Services.AddOptions<ControlPlaneOptions>()
                .BindConfiguration(ControlPlaneOptions.SectionName)
                .ValidateOnStart();
            builder.Services.AddSingleton<IValidateOptions<ControlPlaneOptions>>(
                new ControlPlaneOptionsValidator(mode));
            builder.Services.AddOptions<ServiceEndpointOptions>()
                .BindConfiguration(ServiceEndpointOptions.SectionName)
                .ValidateOnStart();
            builder.Services.AddSingleton<IValidateOptions<ServiceEndpointOptions>>(
                new ServiceEndpointOptionsValidator(mode));
            builder.Services.AddHttpClient(string.Empty, client =>
                client.Timeout = TimeSpan.FromSeconds(30));
            builder.Services.AddHttpClient("cookies", client =>
                client.Timeout = TimeSpan.FromSeconds(30))
                .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
                {
                    UseCookies = true,
                    CookieContainer = new CookieContainer(),
                });
            builder.Services.AddHttpClient("insecure-ingress", client =>
                client.Timeout = TimeSpan.FromSeconds(30))
                .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
                {
                    ServerCertificateCustomValidationCallback =
                        HttpClientHandler.DangerousAcceptAnyServerCertificateValidator,
                    AllowAutoRedirect = false,
                });
            builder.Services.AddHttpClient("plugins", client =>
                client.Timeout = TimeSpan.FromMinutes(2));
            builder.Services.AddSingleton(new ControlPlaneOperation(operation));
            builder.Services.AddHostedService<OneShotOperationService>();

            using var host = builder.Build();
            await host.RunAsync(cancellationToken);
        });
        return command;
    }
}

internal sealed record ControlPlaneOperation(
    Func<IServiceProvider, CancellationToken, Task> ExecuteAsync);

internal sealed class OneShotOperationService(
    ControlPlaneOperation operation,
    IServiceProvider services,
    IHostApplicationLifetime lifetime,
    ILogger<OneShotOperationService> logger) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        logger.LogInformation("Starting Arrspire control-plane operation");
        await operation.ExecuteAsync(services, cancellationToken);
        logger.LogInformation("Arrspire control-plane operation completed");
        lifetime.StopApplication();
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
