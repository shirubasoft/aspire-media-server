using System.Text.Json;
using System.Text.Json.Nodes;

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
            var execution = await ProcessRunner.CaptureAsync(
                "aspire", commandArguments, root, environmentVariables);
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
                Protect(Path.Combine(
                    output,
                    command == "publish" ? ".env" : $".env.{environment}"));
                PublicationValidator.Validate(
                    await File.ReadAllTextAsync(
                        Path.Combine(output, "docker-compose.yaml")));
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

        var runtime = await RuntimeAsync(root);
        if (command == "status")
        {
            await PrintStatusAsync(root, output, environment, runtime);
            return 0;
        }

        var compose = Path.Combine(output, "docker-compose.yaml");
        var environmentFile = Path.Combine(output, $".env.{environment}");
        if (!File.Exists(compose) || !File.Exists(environmentFile))
        {
            throw new InvalidOperationException(
                $"No prepared deployment exists in {output}. Run deploy first.");
        }
        var composeArgs = new List<string>
        {
            "compose", "--env-file", environmentFile, "--file", compose,
        };
        composeArgs.AddRange(command switch
        {
            "down" => ["down", "--remove-orphans"],
            "repair" => ["run", "--rm", "reconciler"],
            _ => throw new InvalidOperationException($"Unsupported deployment command: {command}"),
        });
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
    {
        var configured = Environment.GetEnvironmentVariable("ARRSPIRE_CONTAINER_ENGINE");
        var candidates = configured is "docker" or "podman"
            ? new[] { configured }
            : new[] { "docker", "podman" };
        foreach (var candidate in candidates)
        {
            var info = await ProcessRunner.CaptureAsync(candidate, ["info"], root);
            var compose = await ProcessRunner.CaptureAsync(
                candidate, ["compose", "version"], root);
            if (info.ExitCode == 0 && compose.ExitCode == 0)
            {
                return candidate;
            }
        }
        throw new InvalidOperationException(
            "Neither Docker Compose nor Podman Compose is available.");
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
        string runtime)
    {
        var values = ReadEnvironment(Path.Combine(output, $".env.{environment}"));
        var data = values.GetValueOrDefault("BOOTSTRAP_BINDMOUNT_0")
            ?? Environment.GetEnvironmentVariable("ARRSPIRE_DATA_PATH")
            ?? Path.GetFullPath(Path.Combine(root, "..", "data"));
        Console.WriteLine("Arrspire readiness");
        foreach (var name in new[] { "bootstrap", "reconciliation" })
        {
            var path = Path.Combine(data, "status", name + ".json");
            if (!File.Exists(path))
            {
                Console.WriteLine($"  {name}: pending");
                continue;
            }
            var status = JsonNode.Parse(await File.ReadAllTextAsync(path));
            Console.WriteLine(
                $"  {name}: {status?["status"]?.GetValue<string>() ?? "unknown"} "
                + $"({status?["updatedAt"]?.GetValue<string>() ?? "unknown"})");
            if (status?["results"] is JsonArray results)
            {
                foreach (var result in results.OfType<JsonObject>()
                    .Where(result => result["status"]?.GetValue<string>() == "failed"))
                {
                    Console.WriteLine(
                        $"    {result["name"]}: "
                        + $"{result["reason"]?.GetValue<string>() ?? "failed"}");
                }
            }
        }

        var compose = Path.Combine(output, "docker-compose.yaml");
        var environmentFile = Path.Combine(output, $".env.{environment}");
        if (File.Exists(compose) && File.Exists(environmentFile))
        {
            await ProcessRunner.InheritAsync(
                runtime,
                ["compose", "--env-file", environmentFile, "--file", compose, "ps"],
                root);
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
                    parts => parts[1].Trim('"'),
                    StringComparer.Ordinal);

    private static void Protect(string path)
    {
        if (File.Exists(path) && !OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(
                path,
                UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
    }
}
