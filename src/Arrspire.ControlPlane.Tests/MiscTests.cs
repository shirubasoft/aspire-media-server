using System.Text.Json;

namespace Arrspire.ControlPlane.Tests;

public sealed class MiscTests
{
    [Theory]
    [InlineData("pt-BR", "pb")]
    [InlineData("en", "en")]
    public void BazarrLanguageMappingMatchesProviderCodes(string input, string expected)
        => Assert.Equal(expected, BazarrApi.LanguageCode(input));

    [Fact]
    public void TdarrLibraryDefaultsToHealthChecksOnly()
    {
        var library = TdarrApi.MediaLibrary();
        Assert.True(library["processHealthChecks"]!.GetValue<bool>());
        Assert.False(library["processTranscodes"]!.GetValue<bool>());
        Assert.Equal("/media", library["folder"]!.GetValue<string>());
    }

    [Fact]
    public void TdarrGetAllOmitsFieldsRejectedByTheApi()
    {
        var data = TdarrApi.Crud("getAll")["data"]!.AsObject();
        Assert.False(data.ContainsKey("docID"));
        Assert.False(data.ContainsKey("obj"));
    }

    [Fact]
    public void NtfyIsOptional()
        => Assert.Null(new NtfyOptions().ToConfiguration());

    [Fact]
    public void NtfyRejectsUnsafeTopic()
        => Assert.Throws<InvalidOperationException>(() =>
            new NtfyOptions
            {
                Topic = "not/a/topic",
            }.ToConfiguration());

    [Fact]
    public void NtfyRejectsTokenWithoutTopic()
        => Assert.Throws<InvalidOperationException>(() =>
            new NtfyOptions
            {
                Token = "secret",
            }.ToConfiguration());

    [Fact]
    public void LogRedactsSecretPropertiesAndUrlCredentials()
    {
        var redacted = SecretRedactor.Redact(new
        {
            password = "visible",
            url = "https://user:pass@example.com",
        })!.ToString();
        Assert.DoesNotContain("visible", redacted);
        Assert.DoesNotContain("user:pass", redacted);
    }

    [Fact]
    public async Task RetryTreatsHttpTimeoutAsTransient()
    {
        var attempts = 0;
        var result = await Retry.ExecuteAsync(
            _ => ++attempts == 1
                ? Task.FromException<int>(new TaskCanceledException("timeout"))
                : Task.FromResult(42),
            attempts: 2,
            initialDelay: TimeSpan.Zero,
            maximumDelay: TimeSpan.Zero,
            CancellationToken.None,
            (_, _) => Task.CompletedTask);

        Assert.Equal(42, result);
        Assert.Equal(2, attempts);
    }

    [Fact]
    public async Task RetryDoesNotSwallowCallerCancellation()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var attempts = 0;

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Retry.ExecuteAsync(
                _ =>
                {
                    attempts++;
                    return Task.FromCanceled<int>(cancellation.Token);
                },
                attempts: 3,
                initialDelay: TimeSpan.Zero,
                maximumDelay: TimeSpan.Zero,
                cancellation.Token,
                (_, _) => Task.CompletedTask));
        Assert.Equal(1, attempts);
    }

    [Fact]
    public async Task NotificationStateRoundTripsCamelCaseJson()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            $"arrspire-notification-{Guid.NewGuid():N}");
        var path = Path.Combine(root, "state.json");
        try
        {
            var expected = new NotificationState(1, "failed", "fingerprint");
            await NotificationRelay.WriteStateAsync(
                path,
                expected,
                CancellationToken.None);

            Assert.Equal(
                expected,
                await NotificationRelay.ReadStateAsync(
                    path,
                    CancellationToken.None));
        }
        finally
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }

    [Fact]
    public void NotificationDeliverySerializesItsApiContract()
    {
        var json = JsonSerializer.Serialize(
            new NotificationDelivery(true, false),
            JsonDefaults.Compact);

        Assert.Contains("\"configured\":true", json);
        Assert.Contains("\"sent\":false", json);
    }
}
