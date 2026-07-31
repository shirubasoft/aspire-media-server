using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

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

internal static partial class NotificationRelay
{
    private const string StatePath = "/data/status/notification-state.json";

    public static NtfyConfiguration? Configuration(
        IReadOnlyDictionary<string, string?>? environment = null)
    {
        environment ??= Environment.GetEnvironmentVariables()
            .Cast<System.Collections.DictionaryEntry>()
            .ToDictionary(
                entry => (string)entry.Key,
                entry => entry.Value?.ToString(),
                StringComparer.Ordinal);
        var topic = Value(environment, "NTFY_TOPIC");
        if (topic.Length == 0)
        {
            return null;
        }

        if (!TopicRegex().IsMatch(topic))
        {
            throw new InvalidOperationException(
                "NTFY_TOPIC must be 1-64 letters, numbers, underscores, or hyphens");
        }

        var endpoint = new Uri(
            Value(environment, "NTFY_ENDPOINT") is { Length: > 0 } configured
                ? configured
                : "https://ntfy.sh");
        if (endpoint.Scheme is not ("http" or "https"))
        {
            throw new InvalidOperationException("NTFY_ENDPOINT must be an HTTP or HTTPS URL");
        }

        return new NtfyConfiguration(
            endpoint,
            topic,
            EmptyToNull(Value(environment, "NTFY_TOKEN")),
            EmptyToNull(Value(environment, "ARRSPIRE_HOME_URL")));
    }

    public static async Task<NotificationDelivery> NotifyReconciliationAsync(
        IReadOnlyList<ReconciliationResult> results,
        NtfyConfiguration? configuration = null,
        string statePath = StatePath,
        CancellationToken cancellationToken = default)
    {
        configuration ??= Configuration();
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

    public static async Task RunAsync(CancellationToken cancellationToken)
    {
        var port = Env.Integer("PORT", 8080);
        var listener = new HttpListener();
        listener.Prefixes.Add($"http://*:{port}/");
        listener.Start();
        Log.Info("Notification relay listening", new
        {
            port,
            configured = Configuration() is not null,
        });
        using var registration = cancellationToken.Register(listener.Close);
        while (!cancellationToken.IsCancellationRequested)
        {
            HttpListenerContext context;
            try
            {
                context = await listener.GetContextAsync();
            }
            catch (HttpListenerException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }

            _ = HandleAsync(context, cancellationToken);
        }
    }

    private static async Task HandleAsync(
        HttpListenerContext context,
        CancellationToken cancellationToken)
    {
        try
        {
            if (context.Request.HttpMethod == "GET"
                && context.Request.Url?.AbsolutePath == "/healthz")
            {
                await SendAsync(context.Response, 200, new { status = "ready" }, cancellationToken);
                return;
            }

            if (context.Request.HttpMethod != "POST")
            {
                await SendAsync(context.Response, 404, new { error = "Not found" }, cancellationToken);
                return;
            }

            using var limited = new MemoryStream();
            await context.Request.InputStream.CopyToAsync(limited, cancellationToken);
            if (limited.Length > 256 * 1024)
            {
                throw new InvalidOperationException("Request body exceeds 256 KiB");
            }

            var payload = JsonNode.Parse(limited.ToArray()) as JsonObject
                ?? throw new InvalidOperationException("Expected a JSON object");
            object result;
            if (context.Request.Url?.AbsolutePath == "/reconciliation")
            {
                var results = payload["results"]?.Deserialize<ReconciliationResult[]>(
                    JsonDefaults.Compact)
                    ?? throw new InvalidOperationException(
                        "Expected a reconciliation results array");
                result = await NotifyReconciliationAsync(
                    results,
                    cancellationToken: cancellationToken);
            }
            else if (context.Request.Url?.AbsolutePath == "/diun")
            {
                var configuration = Configuration();
                if (configuration is null)
                {
                    result = new { configured = false, sent = false };
                }
                else
                {
                    var image = payload["image"]?.GetValue<string>() ?? "A container image";
                    var status = payload["status"]?.GetValue<string>() ?? "updated";
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
                    result = new { configured = true, sent = true };
                }
            }
            else
            {
                await SendAsync(context.Response, 404, new { error = "Not found" }, cancellationToken);
                return;
            }

            await SendAsync(context.Response, 200, result, cancellationToken);
        }
        catch (Exception exception)
        {
            Log.Error("Notification request failed", new
            {
                path = context.Request.Url?.AbsolutePath,
                error = exception.Message,
            });
            if (context.Response.OutputStream.CanWrite)
            {
                await SendAsync(
                    context.Response,
                    502,
                    new { error = "Notification delivery failed" },
                    cancellationToken);
            }
        }
    }

    private static async Task PublishAsync(
        NtfyConfiguration configuration,
        object message,
        CancellationToken cancellationToken)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        if (configuration.Token is not null)
        {
            client.DefaultRequestHeaders.Authorization =
                new("Bearer", configuration.Token);
        }

        using var response = await client.PostAsJsonAsync(
            configuration.Endpoint,
            message,
            JsonDefaults.Compact,
            cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"ntfy returned HTTP {(int)response.StatusCode}");
        }
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

    private static async Task SendAsync(
        HttpListenerResponse response,
        int status,
        object value,
        CancellationToken cancellationToken)
    {
        response.StatusCode = status;
        response.ContentType = "application/json";
        await JsonSerializer.SerializeAsync(
            response.OutputStream,
            value,
            JsonDefaults.Compact,
            cancellationToken);
        await response.OutputStream.WriteAsync("\n"u8.ToArray(), cancellationToken);
        response.Close();
    }

    private static string Value(
        IReadOnlyDictionary<string, string?> environment,
        string name)
        => environment.TryGetValue(name, out var value) ? value?.Trim() ?? "" : "";

    private static string? EmptyToNull(string value) => value.Length == 0 ? null : value;

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex TopicRegex();
}
