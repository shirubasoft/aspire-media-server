using System.Text.Json.Nodes;

namespace Arrspire.ControlPlane.Tests;

public sealed class JellyfinApiTests
{
    [Fact]
    public void InitialSubtitleExtractionOnlyStartsIdleIncompleteTasks()
    {
        var tasks = new JsonArray
        {
            Task("subtitles", "ExtractSubtitles", "Idle"),
            Task("attachments", "ExtractAttachments", "Idle"),
            Task("completed", "ExtractSubtitles", "Idle", "Completed"),
            Task("running", "ExtractAttachments", "Running"),
            Task("unrelated", "RefreshLibrary", "Idle"),
        };

        var ids = JellyfinApi.InitialSubtitleExtractionTaskIds(tasks);

        Assert.Equal(["attachments", "subtitles"], ids);
    }

    [Fact]
    public void SubtitleExtractDefaultsPreExtractDuringLibraryScans()
    {
        var defaults = JellyfinApi.SubtitleExtractDefaults();

        Assert.True(defaults["ExtractionDuringLibraryScan"]?.GetValue<bool>());
        Assert.True(defaults["IncludeTextSubtitles"]?.GetValue<bool>());
        Assert.True(defaults["IncludeGraphicalSubtitles"]?.GetValue<bool>());
    }

    private static JsonObject Task(
        string id,
        string key,
        string state,
        string? lastStatus = null)
        => new()
        {
            ["Id"] = id,
            ["Key"] = key,
            ["State"] = state,
            ["LastExecutionResult"] = lastStatus is null
                ? null
                : new JsonObject { ["Status"] = lastStatus },
        };
}
