using System.Text.Json;
using System.Text.Json.Nodes;
using Arrspire.AppHost;
using Arrspire.ControlPlane;

namespace Arrspire.Operator;

internal static class Deployment
{
    public static async Task<int> RunAsync(
        string root,
        string command,
        IReadOnlyList<string> arguments)
    {
        var output = Path.GetFullPath(
            Environment.GetEnvironmentVariable("ARRSPIRE_OUTPUT_PATH")
            ?? Path.Combine(root, "aspire-output"));
        var environment = Environment.GetEnvironmentVariable("ARRSPIRE_ENVIRONMENT")
            ?? "Production";
        if (command is "publish" or "deploy")
        {
            var environmentVariables = await SecretEnvironmentAsync(root);
            var deployRuntime = command == "deploy" ? await RuntimeAsync(root) : null;
            if (deployRuntime is not null)
            {
                environmentVariables["ASPIRE_CONTAINER_RUNTIME"] = deployRuntime;
            }
            var commandArguments = new List<string>
            {
                command,
                "--output-path", output,
                "--environment", environment,
                "--non-interactive",
            };
            commandArguments.AddRange(arguments);
            UnixPermissions.ProtectDirectory(output);
            CommandResult execution;
            try
            {
                using var privateCreation = UnixPermissions.PrivateCreationScope();
                execution = await ProcessRunner.CaptureAsync(
                    "aspire", commandArguments, root, environmentVariables);
            }
            finally
            {
                UnixPermissions.ProtectFile(Path.Combine(output, ".env"));
                UnixPermissions.ProtectFile(
                    Path.Combine(output, $".env.{environment}"));
            }
            Console.Write(execution.StandardOutput);
            Console.Error.Write(execution.StandardError);
            var exitCode = execution.ExitCode;
            if (exitCode != 0 && deployRuntime == "podman"
                && DeploymentSupport.IsPodmanNetworkDependencyFailure(
                    execution.StandardOutput + execution.StandardError))
            {
                await RecoverPodmanAsync(root, output, environment);
                exitCode = 0;
            }
            if (exitCode == 0)
            {
                var paths = ArrspirePaths.Resolve(
                    Path.Combine(root, "Arrspire.AppHost"));
                var ingressPorts = Ingress.ResolvePorts(paths.RootlessPodman);
                PublicationValidator.Validate(
                    await File.ReadAllTextAsync(
                        Path.Combine(output, "docker-compose.yaml")),
                    ingressPorts.Http,
                    ingressPorts.Https);
                if (command == "deploy")
                {
                    var address = await DeploymentSupport.ReconcileHomepageDnsAsync(
                        Path.Combine(output, $".env.{environment}"));
                    await DeploymentSupport.VerifyHomepageAsync(
                        Path.Combine(output, "docker-compose.yaml"),
                        Path.Combine(output, $".env.{environment}"),
                        address);
                    await PrintStatusAsync(
                        root,
                        output,
                        environment,
                        deployRuntime ?? await RuntimeAsync(root));
                }
            }
            return exitCode;
        }

        if (command == "status")
        {
            await PrintStatusAsync(
                root,
                output,
                environment,
                await TryRuntimeAsync(root));
            return 0;
        }

        if (command == "down")
        {
            var destroyEnvironment = await SecretEnvironmentAsync(root);
            if (await TryRuntimeAsync(root) is { } destroyRuntime)
            {
                destroyEnvironment["ASPIRE_CONTAINER_RUNTIME"] = destroyRuntime;
            }
            return await ProcessRunner.InheritAsync(
                "aspire",
                [
                    "destroy",
                    "--output-path", output,
                    "--environment", environment,
                    "--yes",
                    "--non-interactive",
                    "--nologo",
                    .. arguments,
                ],
                root,
                destroyEnvironment);
        }

        var runtime = await RuntimeAsync(root);
        var compose = Path.Combine(output, "docker-compose.yaml");
        var environmentFile = Path.Combine(output, $".env.{environment}");
        if (!File.Exists(compose) || !File.Exists(environmentFile))
        {
            throw new InvalidOperationException(
                $"No prepared deployment exists in {output}. Run deploy first.");
        }
        IReadOnlyList<string> composeCommand = command == "repair"
            ? ["run", "--rm", "--no-deps", "reconciler"]
            : throw new InvalidOperationException($"Unsupported deployment command: {command}");
        var composeArgs = await ComposeArgumentsAsync(
            runtime,
            root,
            compose,
            environmentFile,
            composeCommand);
        var result = await ProcessRunner.InheritAsync(runtime, composeArgs, root);
        if (result == 0 && command == "repair")
        {
            await PrintStatusAsync(root, output, environment, runtime);
        }
        return result;
    }

    private static async Task RecoverPodmanAsync(
        string root,
        string output,
        string environment)
    {
        var compose = Path.Combine(output, "docker-compose.yaml");
        var environmentFile = Path.Combine(output, $".env.{environment}");
        var list = await ProcessRunner.RequireOutputAsync(
            "podman", ["compose", "ls", "--format", "json"], root);
        var project = DeploymentSupport.SelectComposeProjectName(list, compose)
            ?? throw new InvalidOperationException(
                "Podman dependency recovery could not identify the Compose project.");
        var containers = await ProcessRunner.RequireOutputAsync(
            "podman", ["ps", "--all", "--format", "json"], root);
        var plan = DeploymentSupport.PodmanRecoveryPlan(containers, project)
            ?? throw new InvalidOperationException(
                "Podman dependency recovery could not find project-scoped VPN containers.");
        if (await ProcessRunner.InheritAsync(
            "podman", ["rm", "--force", .. plan.Dependents], root) != 0)
        {
            throw new InvalidOperationException("Unable to remove Podman VPN dependents.");
        }
        if (plan.Infrastructure.Count > 0)
        {
            _ = await ProcessRunner.InheritAsync(
                "podman", ["rm", "--force", .. plan.Infrastructure], root);
        }
        var composeArgs = new[]
        {
            "compose", "--project-name", project, "--env-file", environmentFile,
            "--file", compose, "up", "--detach", "--remove-orphans",
        };
        if (await ProcessRunner.InheritAsync("podman", composeArgs, root) != 0)
        {
            throw new InvalidOperationException("Podman recovery deployment failed.");
        }
    }

    private static async Task<string> RuntimeAsync(string root)
        => await TryRuntimeAsync(root)
            ?? throw new InvalidOperationException(
                "Neither Docker Compose nor Podman Compose is available.");

    private static async Task<string?> TryRuntimeAsync(string root)
    {
        var configured = Environment.GetEnvironmentVariable("ASPIRE_CONTAINER_RUNTIME");
        var candidates = configured is "docker" or "podman"
            ? new[] { configured }
            : new[] { "docker", "podman" };
        return await FindRuntimeAsync(
            candidates,
            async candidate =>
            {
                var info = await ProcessRunner.CaptureAsync(candidate, ["info"], root);
                var compose = await ProcessRunner.CaptureAsync(
                    candidate,
                    ["compose", "version"],
                    root);
                return info.ExitCode == 0 && compose.ExitCode == 0;
            });
    }

    internal static async Task<string?> FindRuntimeAsync(
        IEnumerable<string> candidates,
        Func<string, Task<bool>> available)
    {
        foreach (var candidate in candidates)
        {
            try
            {
                if (await available(candidate))
                {
                    return candidate;
                }
            }
            catch
            {
                // A candidate executable may not be installed; continue to the next.
            }
        }
        return null;
    }

    private static async Task<IReadOnlyList<string>> ComposeArgumentsAsync(
        string runtime,
        string root,
        string composeFile,
        string environmentFile,
        IReadOnlyList<string> command)
    {
        string? project = null;
        string? projects = null;
        try
        {
            projects = await ProcessRunner.RequireOutputAsync(
                runtime,
                ["compose", "ls", "--format", "json"],
                root);
        }
        catch
        {
            // No matching running project exists before a first deployment.
        }
        if (projects is not null)
        {
            project = DeploymentSupport.SelectComposeProjectName(
                projects,
                composeFile);
        }

        return DeploymentSupport.ComposeArguments(
            project,
            environmentFile,
            composeFile,
            command);
    }

    private static async Task<Dictionary<string, string?>> SecretEnvironmentAsync(
        string root)
    {
        var result = await ProcessRunner.CaptureAsync(
            "aspire",
            ["secret", "list", "--format", "Json", "--non-interactive", "--nologo"],
            root);
        if (result.ExitCode != 0)
        {
            return [];
        }
        using var document = JsonDocument.Parse(result.StandardOutput);
        return document.RootElement.ValueKind != JsonValueKind.Object
            ? []
            : document.RootElement.EnumerateObject()
                .Where(property => property.Name.StartsWith("Parameters:", StringComparison.Ordinal)
                    && property.Value.ValueKind == JsonValueKind.String)
                .Select(property => new KeyValuePair<string, string?>(
                    "Parameters__"
                        + property.Name["Parameters:".Length..].Replace('-', '_'),
                    Environment.GetEnvironmentVariable(
                        "Parameters__"
                        + property.Name["Parameters:".Length..].Replace('-', '_'))
                        ?? property.Value.GetString()))
                .ToDictionary(StringComparer.Ordinal);
    }

    private static async Task PrintStatusAsync(
        string root,
        string output,
        string environment,
        string? runtime)
    {
        var live = await ProcessRunner.CaptureAsync(
            "aspire",
            ["describe", "--format", "Table", "--non-interactive", "--nologo"],
            root);
        if (live.ExitCode == 0 && !string.IsNullOrWhiteSpace(live.StandardOutput))
        {
            Console.WriteLine("Live Aspire resources");
            Console.WriteLine(live.StandardOutput.TrimEnd());
            Console.WriteLine();
        }

        var values = ReadEnvironment(Path.Combine(output, $".env.{environment}"));
        var data = values.GetValueOrDefault("BOOTSTRAP_BINDMOUNT_0")
            ?? Environment.GetEnvironmentVariable("ARRSPIRE_DATA_PATH")
            ?? Path.GetFullPath(Path.Combine(root, "..", "data"));
        var compose = Path.Combine(output, "docker-compose.yaml");
        var domain = values.GetValueOrDefault("TRAEFIK_DOMAIN")
            ?? Environment.GetEnvironmentVariable("Parameters__traefik_domain")
            ?? Ingress.DefaultTraefikDomain;
        var httpsPort = File.Exists(compose)
            ? Ingress.PublishedTraefikHttpsPort(await File.ReadAllTextAsync(compose))
            : 443;
        PrintAccess(domain, httpsPort);

        Console.WriteLine("\nReadiness");
        JsonObject? reconciliation = null;
        foreach (var name in new[] { "bootstrap", "reconciliation" })
        {
            var path = Path.Combine(data, "status", name + ".json");
            if (!File.Exists(path))
            {
                Console.WriteLine($"  {name}: pending");
                continue;
            }
            JsonObject? status;
            try
            {
                status = JsonNode.Parse(await File.ReadAllTextAsync(path)) as JsonObject;
            }
            catch (JsonException)
            {
                Console.WriteLine($"  {name}: unreadable");
                continue;
            }
            Console.WriteLine(
                $"  {name}: {status?["status"]?.GetValue<string>() ?? "unknown"} "
                + $"({status?["updatedAt"]?.GetValue<string>() ?? "unknown"})");
            if (name == "reconciliation")
            {
                reconciliation = status;
            }
        }
        PrintReconciliationResults(reconciliation);

        var environmentFile = Path.Combine(output, $".env.{environment}");
        if (runtime is not null && File.Exists(compose) && File.Exists(environmentFile))
        {
            Console.WriteLine("\nContainer state");
            var arguments = await ComposeArgumentsAsync(
                runtime,
                root,
                compose,
                environmentFile,
                ["ps"]);
            _ = await ProcessRunner.InheritAsync(runtime, arguments, root);
        }
        else if (runtime is null)
        {
            Console.WriteLine(
                "\nContainer state unavailable; persisted readiness is shown above.");
        }
    }

    private static void PrintAccess(string domain, int httpsPort)
    {
        Console.WriteLine("Arrspire access (HTTPS)");
        foreach (var surface in ServiceSurfaces)
        {
            var host = surface.Name == "home"
                ? domain
                : $"{surface.Name}.{domain}";
            var url = $"https://{host}"
                + (httpsPort == 443 ? string.Empty : $":{httpsPort}");
            Console.WriteLine(
                $"  {surface.Label}: {url} [{surface.Authentication}]");
        }

        Console.WriteLine("Initial credential sources");
        foreach (var credential in CredentialSources)
        {
            Console.WriteLine(
                $"  {credential.Surface}: {credential.Username} / {credential.Password}");
        }
    }

    private static void PrintReconciliationResults(JsonObject? reconciliation)
    {
        if (reconciliation?["results"] is not JsonArray array)
        {
            return;
        }

        var results = array.Deserialize<ReconciliationResult[]>(
            JsonDefaults.Compact) ?? [];
        foreach (var category in new[]
        {
            ("Needs attention", "needs-attention"),
            ("External services unavailable", "externally-unavailable"),
            ("Optional integrations not configured", "not-configured"),
        })
        {
            var matches = results
                .Where(result => Status.ClassifyResult(result) == category.Item2)
                .ToArray();
            if (matches.Length == 0)
            {
                continue;
            }

            Console.WriteLine(category.Item1);
            foreach (var result in matches)
            {
                Console.WriteLine(
                    $"  {result.Name}: {Status.CompactReason(result.Reason)}");
            }
        }
    }

    internal static Dictionary<string, string> ReadEnvironment(string path)
        => !File.Exists(path)
            ? []
            : File.ReadLines(path)
                .Where(line => line.Length > 0 && !line.StartsWith('#') && line.Contains('='))
                .Select(line => line.Split('=', 2))
                .ToDictionary(
                    parts => parts[0],
                    parts => Unquote(parts[1]),
                    StringComparer.Ordinal);

    private static string Unquote(string value)
        => value.StartsWith('"') && value.EndsWith('"') && value.Length >= 2
            ? value[1..^1].Replace("\\\"", "\"", StringComparison.Ordinal)
            : value;

    private static readonly (string Name, string Label, string Authentication)[]
        ServiceSurfaces =
        [
            ("auth", "Arrspire sign-in", "Arrspire sign-in credentials"),
            ("home", "Arrspire home", "Arrspire sign-in"),
            ("jellyfin", "Jellyfin", "Service credentials"),
            ("seerr", "Seerr", "Service credentials"),
            ("sonarr", "Sonarr", "Arrspire sign-in"),
            ("radarr", "Radarr", "Arrspire sign-in"),
            ("lidarr", "Lidarr", "Arrspire sign-in"),
            ("prowlarr", "Prowlarr", "Arrspire sign-in"),
            ("bazarr", "Bazarr", "Arrspire sign-in"),
            ("qbittorrent", "qBittorrent", "Arrspire sign-in + service credentials"),
            ("duplicati", "Duplicati", "Service credentials"),
            ("tdarr", "Tdarr", "Arrspire sign-in"),
            ("aspire", "Aspire dashboard", "Arrspire sign-in"),
            ("traefik", "Traefik dashboard", "Arrspire sign-in"),
        ];

    private static readonly (string Surface, string Username, string Password)[]
        CredentialSources =
        [
            ("Arrspire sign-in", "Parameters:ingress-admin-user",
                "Parameters:ingress-admin-password"),
            ("Jellyfin / Seerr", "Parameters:jellyfin-admin-user",
                "Parameters:jellyfin-admin-password"),
            ("qBittorrent", "admin", "Parameters:qbittorrent-password"),
            ("Duplicati", "(none)", "Parameters:duplicati-web-password"),
        ];
}
