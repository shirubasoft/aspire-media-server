using System.Runtime.Versioning;
using Microsoft.Extensions.Configuration;

namespace Arrspire.AppHost;

internal sealed record ArrspirePaths(
    string Data,
    string Media,
    string Downloads,
    string ContainerSocket,
    bool RootlessPodman)
{
    public static ArrspirePaths Resolve(
        string appHostDirectory,
        IConfiguration? configuration = null,
        string? homeDirectory = null,
        Func<string, bool>? fileExists = null)
    {
        configuration ??= new ConfigurationBuilder()
            .AddEnvironmentVariables()
            .Build();
        homeDirectory ??= Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        fileExists ??= File.Exists;

        var sourceRoot = Path.GetFullPath(Path.Combine(appHostDirectory, ".."));
        var repositoryRoot = Path.GetFullPath(Path.Combine(sourceRoot, ".."));
        var hasOperatorPaths = configuration.GetSection("Paths").Exists();
        if (hasOperatorPaths && configuration.GetValue<int?>("SchemaVersion") != 1)
        {
            throw new InvalidOperationException(
                "Arrspire operator configuration must use schema version 1");
        }
        var uid = UnixIdentity.UserId;
        var podmanSocket = $"/run/user/{uid}/podman/podman.sock";
        var rootlessPodman =
            OperatingSystem.IsLinux()
            && !fileExists("/var/run/docker.sock")
            && fileExists(podmanSocket);

        return new ArrspirePaths(
            configuration["ARRSPIRE_DATA_PATH"]
                ?? configuration["Paths:Data"]
                ?? Path.Combine(repositoryRoot, "data"),
            configuration["ARRSPIRE_MEDIA_PATH"]
                ?? configuration["Paths:Media"]
                ?? Path.Combine(homeDirectory, "media"),
            configuration["ARRSPIRE_DOWNLOADS_PATH"]
                ?? configuration["Paths:Downloads"]
                ?? Path.Combine(homeDirectory, "downloads"),
            configuration["ARRSPIRE_CONTAINER_SOCKET"]
                ?? (rootlessPodman ? podmanSocket : "/var/run/docker.sock"),
            rootlessPodman);
    }

    public void ValidateAndPrepare(bool prepareRootlessRuntime = true)
    {
        var canonical = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["data"] = PrepareDirectory("Data", Data),
            ["media"] = PrepareDirectory("Media", Media),
            ["downloads"] = PrepareDirectory("Downloads", Downloads),
        };
        ValidateLayout(canonical);
        if (prepareRootlessRuntime && RootlessPodman && OperatingSystem.IsLinux())
        {
            MakeRootlessSharedDirectory(canonical["media"]);
            MakeRootlessSharedDirectory(canonical["downloads"]);
        }
        foreach (var library in new[] { "movies", "tv", "music" })
        {
            var path = PrepareDirectory(
                $"{library} library",
                Path.Combine(canonical["media"], library));
            if (prepareRootlessRuntime && RootlessPodman && OperatingSystem.IsLinux())
            {
                MakeRootlessSharedDirectory(path);
            }
        }
    }

    public static void ValidateLayout(IReadOnlyDictionary<string, string> paths)
    {
        foreach (var (name, path) in paths)
        {
            if (!Path.IsPathFullyQualified(path))
            {
                throw new InvalidOperationException($"{name} path must be absolute: {path}");
            }
        }

        var entries = paths
            .Select(pair => new KeyValuePair<string, string>(
                pair.Key,
                CanonicalPath(pair.Value)))
            .ToArray();

        for (var index = 0; index < entries.Length; index++)
        {
            for (var candidateIndex = index + 1; candidateIndex < entries.Length; candidateIndex++)
            {
                var current = entries[index];
                var candidate = entries[candidateIndex];
                if (Contains(current.Value, candidate.Value) || Contains(candidate.Value, current.Value))
                {
                    throw new InvalidOperationException(
                        $"{current.Key} and {candidate.Key} paths must not overlap: "
                        + $"{current.Value} / {candidate.Value}");
                }
            }
        }
    }

    private static string PrepareDirectory(string name, string path)
    {
        if (!Path.IsPathFullyQualified(path))
        {
            throw new InvalidOperationException($"{name} path must be absolute: {path}");
        }

        Directory.CreateDirectory(path);
        var info = new DirectoryInfo(path);
        if (!info.Exists)
        {
            throw new InvalidOperationException($"{name} path is not a directory: {path}");
        }

        return CanonicalPath(info.FullName);
    }

    private static string CanonicalPath(string path)
    {
        var fullPath = Path.GetFullPath(path);
        if (!Directory.Exists(fullPath))
        {
            return Path.TrimEndingDirectorySeparator(fullPath);
        }

        var root = Path.GetPathRoot(fullPath)
            ?? throw new InvalidOperationException($"Path has no root: {path}");
        var current = root;
        foreach (var segment in fullPath[root.Length..].Split(
            [Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar],
            StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            var resolved = new DirectoryInfo(current).ResolveLinkTarget(
                returnFinalTarget: true);
            if (resolved is not null)
            {
                current = resolved.FullName;
            }
        }

        return Path.TrimEndingDirectorySeparator(Path.GetFullPath(current));
    }

    [SupportedOSPlatform("linux")]
    private static void MakeRootlessSharedDirectory(string path)
    {
        const UnixFileMode sharedMode =
            UnixFileMode.UserRead
                | UnixFileMode.UserWrite
                | UnixFileMode.UserExecute
                | UnixFileMode.GroupRead
                | UnixFileMode.GroupWrite
                | UnixFileMode.GroupExecute
                | UnixFileMode.OtherRead
                | UnixFileMode.OtherWrite
                | UnixFileMode.OtherExecute;
        if ((File.GetUnixFileMode(path) & sharedMode) != sharedMode)
        {
            try
            {
                File.SetUnixFileMode(path, sharedMode);
            }
            catch (Exception exception)
                when (exception is UnauthorizedAccessException or IOException)
            {
                Console.Error.WriteLine(
                    $"Warning: rootless Podman already remapped {path}; "
                    + "preserving its existing ownership and mode.");
            }
        }
    }

    private static bool Contains(string parent, string child)
    {
        var relative = Path.GetRelativePath(parent, child);
        return relative == "."
            || (!relative.Equals("..", StringComparison.Ordinal)
                && !relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal)
                && !Path.IsPathFullyQualified(relative));
    }

}
