namespace Arrspire.ControlPlane.Tests;

public sealed class StatusTests
{
    [Fact]
    public void RequiredFailureMakesStackFailed()
        => Assert.Equal(
            Readiness.Failed,
            Status.Classify([new("core", true, "failed", "no")]));

    [Fact]
    public void OptionalFailureNeedsAttention()
        => Assert.Equal(
            Readiness.Attention,
            Status.Classify([new("optional", false, "failed", "no")]));

    [Fact]
    public void ReadyAndSkippedRemainReady()
        => Assert.Equal(
            Readiness.Ready,
            Status.Classify(
            [
                new("core", true, "ready"),
                new("optional", false, "skipped"),
            ]));

    [Theory]
    [InlineData("ready", "operational")]
    [InlineData("skipped", "not-configured")]
    public void ResultCategoriesAreStable(string status, string category)
        => Assert.Equal(category, Status.ClassifyResult(new("x", false, status)));

    [Fact]
    public void PublicIndexerFailureIsExternallyUnavailable()
        => Assert.Equal(
            "externally-unavailable",
            Status.ClassifyResult(new("public-indexer:Knaben", false, "failed")));

    [Fact]
    public void CompactReasonExtractsNestedApiMessage()
        => Assert.Equal(
            "indexer unavailable",
            Status.CompactReason(
                "HTTP 400: {\"errors\":[{\"errorMessage\":\"indexer unavailable\"}]}"));

    [Fact]
    public void CompactReasonTruncatesLongText()
        => Assert.Equal(180, Status.CompactReason(new string('x', 400)).Length);
}
