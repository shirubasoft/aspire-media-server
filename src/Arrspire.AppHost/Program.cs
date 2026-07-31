using Arrspire.AppHost;
using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Publishing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

var builder = DistributedApplication.CreateBuilder(args);
builder.Configuration.AddUserSecrets("arrspire-apphost");
builder.AddDockerComposeEnvironment("arrspire")
    .WithDashboard(dashboard => dashboard
        .WithImageSHA256(
            ArrspireImages.AspireDashboardDigest["sha256:".Length..])
        .WithForwardedHeaders(true)
        .WithHostPort(null)
        .WithEnvironment(
            "DOTNET_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS",
            "true"));

var paths = ArrspirePaths.Resolve(builder.AppHostDirectory);
paths.ValidateAndPrepare(prepareRootlessRuntime: builder.ExecutionContext.IsRunMode);
builder.Services.AddHealthChecks().AddCheck(
    ReconciliationHealth.CheckName,
    () => ReconciliationHealth.Evaluate(
        Path.Combine(paths.Data, "status", "reconciliation.json")));
var parameters = ArrspireParameters.AddTo(builder);
var topology = ArrspireTopologyBuilder.Add(new ArrspireContext(
    builder,
    parameters,
    paths,
    builder.ExecutionContext.IsRunMode));

builder.OnBeforeStart(async (@event, cancellationToken) =>
{
    var runtimeResolver = @event.Services.GetRequiredService<IContainerRuntimeResolver>();
    var runtime = await runtimeResolver.ResolveAsync(cancellationToken);
    if (!await runtime.CheckIfRunningAsync(cancellationToken))
    {
        throw new DistributedApplicationException(
            "The configured Docker or Podman runtime is not running.");
    }
});

topology.Homepage.Resource
    .WithCommand(
        "show-access",
        "Show Arrspire access URL",
        async command =>
        {
            var url = await topology.Homepage.Http.GetValueAsync(
                command.CancellationToken);
            var interaction = command.ServiceProvider
                .GetRequiredService<IInteractionService>();
            if (interaction.IsAvailable)
            {
                await interaction.PromptNotificationAsync(
                    "Arrspire access",
                    $"Homepage endpoint: {url}",
                    new NotificationInteractionOptions(),
                    command.CancellationToken);
            }

            return CommandResults.Success(
                "Arrspire homepage endpoint resolved.",
                url ?? string.Empty,
                CommandResultFormat.Text,
                displayImmediately: true);
        },
        new CommandOptions
        {
            Description =
                "Resolve the live endpoint and display it through the interaction service.",
            IconName = "Open",
        })
    .WithCommand(
        "container-runtime-status",
        "Check container runtime",
        async command =>
        {
            var resolver = command.ServiceProvider
                .GetRequiredService<IContainerRuntimeResolver>();
            var runtime = await resolver.ResolveAsync(command.CancellationToken);
            return await runtime.CheckIfRunningAsync(command.CancellationToken)
                ? CommandResults.Success("The configured container runtime is running.")
                : CommandResults.Failure("The configured container runtime is not running.");
        },
        new CommandOptions
        {
            Description =
                "Use Aspire's container integration to check Docker or Podman.",
            IconName = "CloudCheckmark",
        });

builder.Build().Run();
