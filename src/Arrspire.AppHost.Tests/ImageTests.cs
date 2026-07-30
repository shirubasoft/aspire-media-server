using System.Reflection;
using System.Text.RegularExpressions;
using Arrspire.AppHost;

namespace Arrspire.AppHost.Tests;

public sealed partial class ImageTests
{
    [Fact]
    public void EveryImageUsesAnImmutableDigest()
    {
        var fields = typeof(ArrspireImages).GetFields(
            BindingFlags.Public | BindingFlags.Static);
        Assert.NotEmpty(fields);
        foreach (var field in fields)
        {
            var value = Assert.IsType<string>(field.GetRawConstantValue());
            if (field.Name == nameof(ArrspireImages.AspireDashboardDigest))
            {
                Assert.Matches(DigestRegex(), value);
            }
            else
            {
                Assert.Matches(ImageRegex(), value);
            }
        }
    }

    [GeneratedRegex("^[a-f0-9]{64}$")]
    private static partial Regex DigestRegex();

    [GeneratedRegex(
        "^(?:[a-z0-9.-]+(?::\\d+)?/)?[a-z0-9._/-]+:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$")]
    private static partial Regex ImageRegex();
}
