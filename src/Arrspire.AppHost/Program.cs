using Arrspire.AppHost;
using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Publishing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

var builder = DistributedApplication.CreateBuilder(args);
var operatorConfig = Path.GetFullPath(Path.Combine(
    builder.AppHostDirectory,
    "..",
    ".arrspire",
    "config.json"));
builder.Configuration
    .AddJsonFile(operatorConfig, optional: true, reloadOnChange: false)
    .AddUserSecrets("arrspire-apphost")
    .AddEnvironmentVariables();
builder.AddDockerComposeEnvironment("arrspire")
    .WithDashboard(dashboard => dashboard
        .WithImageSHA256(
            ArrspireImages.AspireDashboardDigest["sha256:".Length..])
        .WithForwardedHeaders(true)
        .WithHostPort(null)
        .WithEnvironment(
            "DOTNET_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS",
            "true"));

var paths = ArrspirePaths.Resolve(builder.AppHostDirectory, builder.Configuration);
paths.ValidateAndPrepare(prepareRootlessRuntime: builder.ExecutionContext.IsRunMode);
var parameters = ArrspireParameters.AddTo(builder);
var topology = ArrspireTopologyBuilder.Add(new ArrspireContext(
    builder,
    parameters,
    paths,
    builder.ExecutionContext.IsRunMode));

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
