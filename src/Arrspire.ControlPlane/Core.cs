using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Arrspire.ControlPlane;

internal static class Retry
{
    public static async Task<T> ExecuteAsync<T>(
        Func<CancellationToken, Task<T>> operation,
        int attempts,
        TimeSpan initialDelay,
        TimeSpan maximumDelay,
        CancellationToken cancellationToken,
        Func<TimeSpan, CancellationToken, Task>? wait = null)
    {
        if (attempts < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(attempts));
        }

        var nextDelay = initialDelay;
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                return await operation(cancellationToken);
            }
            catch (Exception exception) when (
                attempt < attempts
                && (exception is not OperationCanceledException
                    || !cancellationToken.IsCancellationRequested))
            {
                var delay = nextDelay < maximumDelay ? nextDelay : maximumDelay;
                await (wait ?? Task.Delay)(delay, cancellationToken);
                nextDelay = TimeSpan.FromMilliseconds(
                    Math.Min(delay.TotalMilliseconds * 2, maximumDelay.TotalMilliseconds));
            }
        }
    }

    public static async Task ExecuteAsync(
        Func<CancellationToken, Task> operation,
        int attempts,
        TimeSpan initialDelay,
        TimeSpan maximumDelay,
        CancellationToken cancellationToken)
        => await ExecuteAsync(
            async token =>
            {
                await operation(token);
                return true;
            },
            attempts,
            initialDelay,
            maximumDelay,
            cancellationToken);
}

internal static partial class SecretRedactor
{
    private static readonly Regex SensitiveName = SensitiveNameRegex();
    private static readonly Regex InlineSecret = InlineSecretRegex();
    private static readonly Regex UserInfo = UserInfoRegex();

    public static object? Redact(object? value, string propertyName = "")
    {
        if (SensitiveName.IsMatch(propertyName))
        {
            return "[REDACTED]";
        }

        if (value is string text)
        {
            return RedactString(text);
        }

        var node = JsonSerializer.SerializeToNode(value);
        return RedactNode(node, propertyName);
    }

    private static JsonNode? RedactNode(JsonNode? node, string propertyName)
    {
        if (SensitiveName.IsMatch(propertyName))
        {
            return JsonValue.Create("[REDACTED]");
        }

        return node switch
        {
            JsonObject value => new JsonObject(
                value.Select(pair => new KeyValuePair<string, JsonNode?>(
                    pair.Key,
                    RedactNode(pair.Value, pair.Key)))),
            JsonArray value => new JsonArray(
                value.Select(item => RedactNode(item, propertyName)).ToArray()),
            JsonValue value when value.TryGetValue<string>(out var text)
                => JsonValue.Create(RedactString(text)),
            _ => node?.DeepClone(),
        };
    }

    private static string RedactString(string value)
    {
        var redacted = InlineSecret.Replace(value, "$1[REDACTED]");
        redacted = UserInfo.Replace(redacted, "$1[REDACTED]@");
        foreach (var secret in Environment.GetEnvironmentVariables()
            .Cast<System.Collections.DictionaryEntry>()
            .Where(entry => entry.Value is string text
                && text.Length >= 4
                && SensitiveName.IsMatch((string)entry.Key))
            .Select(entry => (string)entry.Value!)
            .OrderByDescending(secret => secret.Length))
        {
            redacted = redacted.Replace(secret, "[REDACTED]", StringComparison.Ordinal);
        }

        return redacted;
    }

    [GeneratedRegex(
        "(?:api[-_]?key|authorization|cookie|credential|password|private[-_]?key|secret|token)",
        RegexOptions.IgnoreCase)]
    private static partial Regex SensitiveNameRegex();

    [GeneratedRegex(
        "((?:api[-_]?key|authorization|cookie|credential|password|private[-_]?key|secret|token)[\"']?\\s*[:=]\\s*[\"']?)[^\"',;\\s}]+",
        RegexOptions.IgnoreCase)]
    private static partial Regex InlineSecretRegex();

    [GeneratedRegex("(https?://)[^/@\\s]+@", RegexOptions.IgnoreCase)]
    private static partial Regex UserInfoRegex();
}

internal static class AtomicFiles
{
    public static async Task<string?> ReadIfExistsAsync(
        string path,
        CancellationToken cancellationToken = default)
    {
        try
        {
            return await File.ReadAllTextAsync(path, cancellationToken);
        }
        catch (FileNotFoundException)
        {
            return null;
        }
        catch (DirectoryNotFoundException)
        {
            return null;
        }
    }

    public static async Task<bool> WriteIfChangedAsync(
        string path,
        string content,
        UnixFileMode mode = UnixFileMode.UserRead | UnixFileMode.UserWrite,
        CancellationToken cancellationToken = default)
    {
        if (await ReadIfExistsAsync(path, cancellationToken) == content)
        {
            return false;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = $"{path}.{Environment.ProcessId}.tmp";
        await File.WriteAllTextAsync(temporary, content, new UTF8Encoding(false), cancellationToken);
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(temporary, mode);
        }

        File.Move(temporary, path, overwrite: true);
        return true;
    }

    public static async Task<bool> WriteOnceAsync(
        string path,
        string content,
        UnixFileMode mode = UnixFileMode.UserRead | UnixFileMode.UserWrite,
        CancellationToken cancellationToken = default)
        => await ReadIfExistsAsync(path, cancellationToken) is not null
            ? false
            : await WriteIfChangedAsync(path, content, mode, cancellationToken);
}

internal static class JsonDefaults
{
    public static readonly JsonSerializerOptions Compact = new(JsonSerializerDefaults.Web);
    public static readonly JsonSerializerOptions Indented = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };
}

internal static class Digests
{
    public static string Sha256(string value)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
