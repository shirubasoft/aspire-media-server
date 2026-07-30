using System.Text.Json;
using System.Runtime.Versioning;
using Arrspire.AppHost;

namespace Arrspire.AppHost.Tests;

public sealed class ArrspirePathsTests
{
    [Fact]
    public void RejectsOverlappingPaths()
    {
        var paths = new Dictionary<string, string>
        {
            ["data"] = "/srv/arrspire",
            ["media"] = "/srv/arrspire/media",
            ["downloads"] = "/srv/downloads",
        };

        Assert.Throws<InvalidOperationException>(() => ArrspirePaths.ValidateLayout(paths));
    }

    [Fact]
    public void RejectsRelativePaths()
    {
        var paths = new Dictionary<string, string>
        {
            ["data"] = "data",
            ["media"] = "/srv/media",
            ["downloads"] = "/srv/downloads",
        };

        Assert.Throws<InvalidOperationException>(() => ArrspirePaths.ValidateLayout(paths));
    }

    [Fact]
    public void LoadsIgnoredOperatorConfiguration()
    {
        var root = Path.Combine(Path.GetTempPath(), $"arrspire-paths-{Guid.NewGuid():N}");
        var appHostDirectory = Path.Combine(root, "Arrspire.AppHost");
        Directory.CreateDirectory(Path.Combine(appHostDirectory, ".arrspire"));
        try
        {
            File.WriteAllText(
                Path.Combine(appHostDirectory, ".arrspire", "config.json"),
                JsonSerializer.Serialize(new
                {
                    schemaVersion = 1,
                    paths = new
                    {
                        data = "/opt/arrspire/data",
                        media = "/opt/arrspire/media",
                        downloads = "/opt/arrspire/downloads",
                    },
                }));

            var resolved = ArrspirePaths.Resolve(
                appHostDirectory,
                new Dictionary<string, string?>(),
                "/home/test",
                _ => false);

            Assert.Equal("/opt/arrspire/data", resolved.Data);
            Assert.Equal("/opt/arrspire/media", resolved.Media);
            Assert.Equal("/opt/arrspire/downloads", resolved.Downloads);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void PrepareCreatesRootlessWritableMediaLibraries()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            $"arrspire-prepare-{Guid.NewGuid():N}");
        try
        {
            var paths = new ArrspirePaths(
                Path.Combine(root, "data"),
                Path.Combine(root, "media"),
                Path.Combine(root, "downloads"),
                "/var/run/docker.sock",
                true);
            paths.ValidateAndPrepare();

            Assert.All(
                new[] { "movies", "tv", "music" },
                name => Assert.True(
                    Directory.Exists(Path.Combine(paths.Media, name))));
            if (OperatingSystem.IsLinux())
            {
                AssertRootlessModes(paths);
            }
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [SupportedOSPlatform("linux")]
    private static void AssertRootlessModes(ArrspirePaths paths)
        => Assert.All(
            new[]
            {
                paths.Media,
                paths.Downloads,
                Path.Combine(paths.Media, "movies"),
                Path.Combine(paths.Media, "tv"),
                Path.Combine(paths.Media, "music"),
            },
            path => Assert.Equal(
                UnixFileMode.UserRead
                    | UnixFileMode.UserWrite
                    | UnixFileMode.UserExecute
                    | UnixFileMode.GroupRead
                    | UnixFileMode.GroupWrite
                    | UnixFileMode.GroupExecute
                    | UnixFileMode.OtherRead
                    | UnixFileMode.OtherWrite
                    | UnixFileMode.OtherExecute,
                File.GetUnixFileMode(path)));
}
