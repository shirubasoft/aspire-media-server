using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Arrspire.ControlPlane;

internal enum Readiness
{
    Ready,
    Attention,
    Failed,
}

internal sealed record ReconciliationResult(
    string Name,
    bool Required,
    string Status,
    string? Reason = null);

internal sealed record ReconciliationSummary(
    int SchemaVersion,
    string Phase,
    string Status,
    DateTimeOffset UpdatedAt,
    IReadOnlyList<ReconciliationResult> Results);

internal static partial class Status
{
    public const string StatusDirectory = "/data/status";

    public static Readiness Classify(IEnumerable<ReconciliationResult> results)
    {
        var materialized = results.ToArray();
        if (materialized.Any(result => result.Required && result.Status == "failed"))
        {
            return Readiness.Failed;
        }

        return materialized.Any(result => result.Status == "failed")
            ? Readiness.Attention
            : Readiness.Ready;
    }

    public static string ClassifyResult(ReconciliationResult result)
        => result.Status switch
        {
            "ready" => "operational",
            "skipped" => "not-configured",
            "failed" when !result.Required
                && result.Name.StartsWith("public-indexer:", StringComparison.Ordinal)
                => "externally-unavailable",
            _ => "needs-attention",
        };

    public static string CompactReason(string? reason)
    {
        if (reason is null)
        {
            return "-";
        }

        var normalized = WhitespaceRegex().Replace(reason, " ").Trim();
        var jsonStart = normalized.IndexOfAny(['[', '{']);
        if (jsonStart >= 0)
        {
            try
            {
                var message = NestedMessage(JsonNode.Parse(normalized[jsonStart..]));
                if (!string.IsNullOrWhiteSpace(message))
                {
                    return message;
                }
            }
            catch (JsonException)
            {
            }
        }

        return normalized.Length > 180 ? normalized[..177] + "..." : normalized;
    }

    public static Task WriteBootstrapAsync(CancellationToken cancellationToken)
        => AtomicFiles.WriteIfChangedAsync(
            Path.Combine(StatusDirectory, "bootstrap.json"),
            JsonSerializer.Serialize(
                new
                {
                    schemaVersion = 1,
                    phase = "bootstrap",
                    status = "ready",
                    updatedAt = DateTimeOffset.UtcNow,
                },
                JsonDefaults.Indented) + "\n",
            UnixFileMode.UserRead | UnixFileMode.UserWrite
                | UnixFileMode.GroupRead | UnixFileMode.OtherRead,
            cancellationToken);

    public static async Task<ReconciliationSummary> WriteReconciliationAsync(
        IReadOnlyList<ReconciliationResult> results,
        CancellationToken cancellationToken)
    {
        var redacted = results.Select(result => result with
        {
            Reason = SecretRedactor.Redact(result.Reason)?.ToString(),
        }).ToArray();
        var summary = new ReconciliationSummary(
            2,
            "reconciliation",
            Classify(redacted).ToString().ToLowerInvariant(),
            DateTimeOffset.UtcNow,
            redacted);
        await AtomicFiles.WriteIfChangedAsync(
            Path.Combine(StatusDirectory, "reconciliation.json"),
            JsonSerializer.Serialize(summary, JsonDefaults.Indented) + "\n",
            UnixFileMode.UserRead | UnixFileMode.UserWrite
                | UnixFileMode.GroupRead | UnixFileMode.OtherRead,
            cancellationToken);
        return summary;
    }

    public static Task WriteReconciliationPendingAsync(
        CancellationToken cancellationToken)
        => AtomicFiles.WriteIfChangedAsync(
            Path.Combine(StatusDirectory, "reconciliation.json"),
            JsonSerializer.Serialize(
                new
                {
                    schemaVersion = 2,
                    phase = "reconciliation",
                    status = "pending",
                    updatedAt = DateTimeOffset.UtcNow,
                    results = Array.Empty<ReconciliationResult>(),
                },
                JsonDefaults.Indented) + "\n",
            UnixFileMode.UserRead | UnixFileMode.UserWrite
                | UnixFileMode.GroupRead | UnixFileMode.OtherRead,
            cancellationToken);

    private static string? NestedMessage(JsonNode? value)
    {
        if (value is JsonArray array)
        {
            return array.Select(NestedMessage).FirstOrDefault(message => message is not null);
        }

        if (value is not JsonObject record)
        {
            return null;
        }

        foreach (var key in new[] { "errorMessage", "message", "detail", "title" })
        {
            if (record[key]?.GetValue<string>() is { Length: > 0 } message)
            {
                return message.Trim();
            }
        }

        return record.Select(pair => NestedMessage(pair.Value))
            .FirstOrDefault(message => message is not null);
    }

    [GeneratedRegex("\\s+")]
    private static partial Regex WhitespaceRegex();
}
