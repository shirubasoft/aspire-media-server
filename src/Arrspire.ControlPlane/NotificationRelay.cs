using System.Net.Http.Json;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Arrspire.ControlPlane;

internal sealed record NtfyConfiguration(
    Uri Endpoint,
    string Topic,
    string? Token,
    string? Click);

internal sealed record NotificationDelivery(bool Configured, bool Sent);

internal sealed record NotificationState(
    int SchemaVersion,
    string Status,
    string Fingerprint);

internal sealed record DiunNotification(string? Image, string? Status);

internal sealed partial class NtfyOptions
{
    public const string SectionName = "Ntfy";

    public string Endpoint { get; init; } = "https://ntfy.sh";
    public string Topic { get; init; } = string.Empty;
    public string? Token { get; init; }
    public string? Click { get; init; }

    public NtfyConfiguration? ToConfiguration()
    {
        var topic = Topic.Trim();
        if (topic.Length == 0)
        {
            if (!string.IsNullOrWhiteSpace(Token))
            {
                throw new InvalidOperationException(
                    "Ntfy:Token requires Ntfy:Topic");
            }
            return null;
        }

        if (!TopicRegex().IsMatch(topic))
        {
            throw new InvalidOperationException(
                "Ntfy:Topic must be 1-64 letters, numbers, underscores, or hyphens");
        }
        if (!Uri.TryCreate(Endpoint, UriKind.Absolute, out var endpoint)
            || endpoint.Scheme is not ("http" or "https"))
        {
            throw new InvalidOperationException(
                "Ntfy:Endpoint must be an absolute HTTP or HTTPS URL");
        }

        return new(
            endpoint,
            topic,
            string.IsNullOrWhiteSpace(Token) ? null : Token.Trim(),
            string.IsNullOrWhiteSpace(Click) ? null : Click.Trim());
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex TopicRegex();
}

internal sealed class NtfyOptionsValidator : IValidateOptions<NtfyOptions>
{
    public ValidateOptionsResult Validate(string? name, NtfyOptions options)
    {
        try
        {
            _ = options.ToConfiguration();
            return ValidateOptionsResult.Success;
        }
        catch (InvalidOperationException exception)
        {
            return ValidateOptionsResult.Fail(exception.Message);
        }
    }
}

internal sealed class NotificationRelay(
    HttpClient client,
    IOptions<NtfyOptions> options,
    ILogger<NotificationRelay> logger)
{
    public async Task<NotificationDelivery> NotifyReconciliationAsync(
        IReadOnlyList<ReconciliationResult> results,
        string statePath,
        CancellationToken cancellationToken)
    {
        var configuration = options.Value.ToConfiguration();
        if (configuration is null)
        {
            return new(false, false);
        }

        var status = Status.Classify(results).ToString().ToLowerInvariant();
        var fingerprint = Fingerprint(results);
        var previous = await ReadStateAsync(statePath, cancellationToken);
        var recovered = status == "ready" && previous?.Status != "ready" && previous is not null;
        var degraded = status != "ready" && previous?.Fingerprint != fingerprint;
        if (recovered || degraded)
        {
            var failures = string.Join(
                '\n',
                results.Where(result => result.Status == "failed")
                    .Select(result => $"{result.Name}: {Status.CompactReason(result.Reason)}"));
            await PublishAsync(
                configuration,
                new
                {
                    topic = configuration.Topic,
                    title = status switch
                    {
                        "ready" => "Arrspire recovered",
                        "failed" => "Arrspire reconciliation failed",
                        _ => "Arrspire needs attention",
                    },
                    message = status == "ready"
                        ? "All required services and configured integrations are operational."
                        : failures.Length > 0
                            ? failures
                            : "One or more integrations need attention.",
                    priority = status switch { "failed" => 5, "attention" => 4, _ => 3 },
                    tags = status switch
                    {
                        "failed" => new[] { "rotating_light", "movie_camera" },
                        "attention" => new[] { "warning", "movie_camera" },
                        _ => new[] { "white_check_mark", "movie_camera" },
                    },
                    click = configuration.Click,
                },
                cancellationToken);
        }

        await WriteStateAsync(
            statePath,
            new NotificationState(1, status, fingerprint),
            cancellationToken);
        return new(true, recovered || degraded);
    }

    public async Task<NotificationDelivery> NotifyDiunAsync(
        DiunNotification notification,
        CancellationToken cancellationToken)
    {
        var configuration = options.Value.ToConfiguration();
        if (configuration is null)
        {
            return new(false, false);
        }

        var image = string.IsNullOrWhiteSpace(notification.Image)
            ? "A container image"
            : notification.Image;
        var status = string.IsNullOrWhiteSpace(notification.Status)
            ? "updated"
            : notification.Status;
        await PublishAsync(
            configuration,
            new
            {
                topic = configuration.Topic,
                title = $"{image} has an update",
                message = $"{image} was reported as {status} by DIUN.",
                priority = 3,
                tags = new[] { "package", "whale" },
                click = configuration.Click,
            },
            cancellationToken);
        return new(true, true);
    }

    private async Task PublishAsync(
        NtfyConfiguration configuration,
        object message,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, configuration.Endpoint)
        {
            Content = JsonContent.Create(message, options: JsonDefaults.Compact),
        };
        if (configuration.Token is not null)
        {
            request.Headers.Authorization =
                new AuthenticationHeaderValue("Bearer", configuration.Token);
        }

        using var response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"ntfy returned HTTP {(int)response.StatusCode}");
        }
        logger.LogInformation("Notification delivered to ntfy topic {Topic}", configuration.Topic);
    }

    private static string Fingerprint(IReadOnlyList<ReconciliationResult> results)
    {
        var normalized = new
        {
            status = Status.Classify(results).ToString().ToLowerInvariant(),
            failures = results.Where(result => result.Status == "failed")
                .OrderBy(result => result.Name, StringComparer.Ordinal)
                .Select(result => new
                {
                    result.Name,
                    result.Required,
                    Reason = Status.CompactReason(result.Reason),
                }),
        };
        return Convert.ToHexStringLower(
            SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(normalized)));
    }

    internal static async Task<NotificationState?> ReadStateAsync(
        string path,
        CancellationToken cancellationToken)
    {
        try
        {
            return JsonSerializer.Deserialize<NotificationState>(
                await AtomicFiles.ReadIfExistsAsync(path, cancellationToken) ?? "",
                JsonDefaults.Compact);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    internal static Task WriteStateAsync(
        string path,
        NotificationState state,
        CancellationToken cancellationToken)
        => AtomicFiles.WriteIfChangedAsync(
            path,
            JsonSerializer.Serialize(state, JsonDefaults.Indented) + "\n",
            cancellationToken: cancellationToken);

}
