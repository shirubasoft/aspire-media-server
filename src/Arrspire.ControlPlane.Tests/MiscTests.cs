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
        => Assert.Null(NotificationRelay.Configuration(new Dictionary<string, string?>()));

    [Fact]
    public void NtfyRejectsUnsafeTopic()
        => Assert.Throws<InvalidOperationException>(() =>
            NotificationRelay.Configuration(new Dictionary<string, string?>
            {
                ["NTFY_TOPIC"] = "not/a/topic",
            }));

    [Fact]
    public void LogRedactsSecretPropertiesAndUrlCredentials()
    {
        var redacted = Log.Redact(new
        {
            password = "visible",
            url = "https://user:pass@example.com",
        })!.ToString();
        Assert.DoesNotContain("visible", redacted);
        Assert.DoesNotContain("user:pass", redacted);
    }
}
