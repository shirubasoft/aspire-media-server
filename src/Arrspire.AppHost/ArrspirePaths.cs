using System.Text.Json;
using System.Runtime.Versioning;

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
        IReadOnlyDictionary<string, string?>? environment = null,
        string? homeDirectory = null,
        Func<string, bool>? fileExists = null)
    {
        environment ??= Environment.GetEnvironmentVariables()
            .Cast<System.Collections.DictionaryEntry>()
            .ToDictionary(
                entry => (string)entry.Key,
                entry => entry.Value?.ToString(),
                StringComparer.Ordinal);
        homeDirectory ??= Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        fileExists ??= File.Exists;

        var sourceRoot = Path.GetFullPath(Path.Combine(appHostDirectory, ".."));
        var operatorConfig = ReadOperatorConfig(sourceRoot)
            ?? ReadOperatorConfig(appHostDirectory);
        var uid = UnixIdentity.UserId;
        var podmanSocket = $"/run/user/{uid}/podman/podman.sock";
        var rootlessPodman =
            OperatingSystem.IsLinux()
            && !fileExists("/var/run/docker.sock")
            && fileExists(podmanSocket);

        return new ArrspirePaths(
            Get(environment, "ARRSPIRE_DATA_PATH")
                ?? operatorConfig?.Paths.Data
                ?? Path.Combine(sourceRoot, "data"),
            Get(environment, "ARRSPIRE_MEDIA_PATH")
                ?? operatorConfig?.Paths.Media
                ?? Path.Combine(homeDirectory, "media"),
            Get(environment, "ARRSPIRE_DOWNLOADS_PATH")
                ?? operatorConfig?.Paths.Downloads
                ?? Path.Combine(homeDirectory, "downloads"),
            Get(environment, "ARRSPIRE_CONTAINER_SOCKET")
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
                Path.TrimEndingDirectorySeparator(Path.GetFullPath(pair.Value))))
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

    private static OperatorConfig? ReadOperatorConfig(string appHostDirectory)
    {
        var path = Path.Combine(appHostDirectory, ".arrspire", "config.json");
        if (!File.Exists(path))
        {
            return null;
        }

        try
        {
            var config = JsonSerializer.Deserialize<OperatorConfig>(
                File.ReadAllText(path),
                JsonOptions);
            if (config is null
                || config.SchemaVersion != 1
                || string.IsNullOrWhiteSpace(config.Paths?.Data)
                || string.IsNullOrWhiteSpace(config.Paths.Media)
                || string.IsNullOrWhiteSpace(config.Paths.Downloads))
            {
                throw new InvalidOperationException(
                    $"Arrspire operator config {path} does not match schema version 1");
            }

            return config;
        }
        catch (InvalidOperationException)
        {
            throw;
        }
        catch (Exception exception)
        {
            throw new InvalidOperationException(
                $"Unable to read Arrspire operator config {path}: {exception.Message}",
                exception);
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

        return info.FullName;
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

    private static string? Get(IReadOnlyDictionary<string, string?> environment, string name)
        => environment.TryGetValue(name, out var value) && !string.IsNullOrEmpty(value)
            ? value
            : null;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private sealed record OperatorConfig(int SchemaVersion, OperatorPaths Paths);
    private sealed record OperatorPaths(string Data, string Media, string Downloads);
}
