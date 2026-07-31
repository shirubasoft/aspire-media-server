using Arrspire.ControlPlane;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();
builder.Services.AddProblemDetails();
builder.Services.AddOptions<NotificationEndpointOptions>()
    .BindConfiguration(NotificationEndpointOptions.SectionName)
    .Validate(options => Path.IsPathFullyQualified(options.StatePath),
        "Notification:StatePath must be an absolute path.")
    .ValidateOnStart();
builder.Services.AddOptions<NtfyOptions>()
    .BindConfiguration(NtfyOptions.SectionName)
    .ValidateOnStart();
builder.Services.AddSingleton<IValidateOptions<NtfyOptions>, NtfyOptionsValidator>();
builder.Services.AddHttpClient<NotificationRelay>(client =>
    client.Timeout = TimeSpan.FromSeconds(10));
builder.WebHost.ConfigureKestrel(options =>
    options.Limits.MaxRequestBodySize = 256 * 1024);

var app = builder.Build();
app.UseExceptionHandler(exceptionHandler => exceptionHandler.Run(async context =>
{
    var exception = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    app.Logger.LogError(exception, "Notification request failed");
    await Results.Problem(
        statusCode: StatusCodes.Status502BadGateway,
        title: "Notification delivery failed").ExecuteAsync(context);
}));

app.MapHealthChecks("/healthz", new HealthCheckOptions());
app.MapPost(
    "/reconciliation",
    async Task<Ok<NotificationDelivery>> (
        ReconciliationRequest request,
        NotificationRelay relay,
        IOptions<NotificationEndpointOptions> options,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await relay.NotifyReconciliationAsync(
            request.Results,
            options.Value.StatePath,
            cancellationToken)));
app.MapPost(
    "/diun",
    async Task<Ok<NotificationDelivery>> (
        DiunNotification request,
        NotificationRelay relay,
        CancellationToken cancellationToken) =>
        TypedResults.Ok(await relay.NotifyDiunAsync(request, cancellationToken)));
app.MapDefaultEndpoints();

await app.RunAsync();

internal sealed record ReconciliationRequest(IReadOnlyList<ReconciliationResult> Results);

internal sealed class NotificationEndpointOptions
{
    public const string SectionName = "Notification";

    public string StatePath { get; init; } = "/data/status/notification-state.json";
}

namespace Arrspire.Notifier.Hosting
{
    public sealed class NotifierAssemblyMarker;
}
