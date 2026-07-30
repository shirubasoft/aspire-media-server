using System.Diagnostics;

return await VpnContainerRunner.RunAsync(args);

internal static class VpnContainerRunner
{
    public static async Task<int> RunAsync(string[] args)
    {
        if (args is [
            "watch",
            var watchRuntime,
            var watchContainer,
            var watchGluetun,
            var wrapperPidValue,
            var watchAppHostPidValue]
            && int.TryParse(wrapperPidValue, out var wrapperPid)
            && int.TryParse(watchAppHostPidValue, out var watchAppHostPid))
        {
            await WatchDetachedAsync(
                watchRuntime,
                watchContainer,
                watchGluetun,
                wrapperPid,
                watchAppHostPid);
            return 0;
        }

        if (args is not [
            var runtime,
            var containerName,
            var gluetunContainerName,
            var appHostPidValue,
            .. var runArguments]
            || !int.TryParse(appHostPidValue, out var appHostPid))
        {
            Console.Error.WriteLine(
                "Usage: container-runner <runtime> <container-name> "
                + "<gluetun-name> <apphost-pid> <run-args...>");
            return 2;
        }

        using var shutdown = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            shutdown.Cancel();
        };
        AppDomain.CurrentDomain.ProcessExit += (_, _) => shutdown.Cancel();

        StartWatchdog(
            runtime,
            containerName,
            gluetunContainerName,
            Environment.ProcessId,
            appHostPid);

        using var child = Start(runtime, runArguments);
        try
        {
            await child.WaitForExitAsync(shutdown.Token);
            shutdown.Cancel();
            return child.ExitCode;
        }
        catch (OperationCanceledException)
        {
            Remove(runtime, containerName);
            return 0;
        }
        finally
        {
            Remove(runtime, containerName);
        }
    }

    private static async Task WatchDetachedAsync(
        string runtime,
        string containerName,
        string gluetunContainerName,
        int wrapperPid,
        int appHostPid)
    {
        var wrapperCleaned = false;
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(250));
        while (await timer.WaitForNextTickAsync())
        {
            var appHostAlive = ProcessExists(appHostPid);
            var wrapperAlive = ProcessExists(wrapperPid);
            if (!wrapperAlive && !wrapperCleaned)
            {
                wrapperCleaned = true;
                Remove(runtime, containerName);
            }

            if (!appHostAlive)
            {
                Remove(runtime, containerName);
                Remove(runtime, gluetunContainerName);
                return;
            }
        }
    }

    private static void StartWatchdog(
        string runtime,
        string containerName,
        string gluetunContainerName,
        int wrapperPid,
        int appHostPid)
    {
        var processPath = Environment.ProcessPath
            ?? throw new InvalidOperationException("Unable to resolve the runner executable.");
        var arguments = new List<string>();
        if (Path.GetFileNameWithoutExtension(processPath)
            .Equals("dotnet", StringComparison.OrdinalIgnoreCase))
        {
            arguments.Add(typeof(VpnContainerRunner).Assembly.Location);
        }

        arguments.AddRange(
        [
            "watch",
            runtime,
            containerName,
            gluetunContainerName,
            wrapperPid.ToString(),
            appHostPid.ToString(),
        ]);

        ProcessStartInfo startInfo;
        if (OperatingSystem.IsLinux())
        {
            startInfo = new ProcessStartInfo("setsid")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            startInfo.ArgumentList.Add(processPath);
        }
        else
        {
            startInfo = new ProcessStartInfo(processPath)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
            };
        }

        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        _ = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Unable to launch the VPN lifecycle watchdog.");
    }

    private static Process Start(string executable, IEnumerable<string> arguments)
    {
        var startInfo = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
        };
        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        return Process.Start(startInfo)
            ?? throw new InvalidOperationException($"Unable to launch {executable}");
    }

    private static bool ProcessExists(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            return !process.HasExited;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    private static void Remove(string runtime, string name)
    {
        try
        {
            using var process = Start(runtime, ["rm", "--force", name]);
            process.WaitForExit(TimeSpan.FromSeconds(10));
        }
        catch
        {
            // Cleanup is best effort; the exact names allow a later command to retry safely.
        }
    }
}
