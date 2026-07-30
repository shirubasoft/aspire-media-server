using System.Text.RegularExpressions;
using Aspire.Hosting.ApplicationModel;

namespace Arrspire.AppHost.Resources;

internal static partial class VpnResources
{
    private const string PortForwardingUpCommand =
        "/bin/sh -c 'wget -O- -nv --tries=60 --waitretry=1 --retry-connrefused "
        + "--post-data \"json={\\\"listen_port\\\":{{PORT}},"
        + "\\\"current_network_interface\\\":\\\"{{VPN_INTERFACE}}\\\","
        + "\\\"random_port\\\":false,\\\"upnp\\\":false}\" "
        + "http://127.0.0.1:8080/api/v2/app/setPreferences'";

    private const string PortForwardingDownCommand =
        "/bin/sh -c 'wget -O- -nv --tries=60 --waitretry=1 --retry-connrefused "
        + "--post-data \"json={\\\"listen_port\\\":0,"
        + "\\\"current_network_interface\\\":\\\"lo\\\"}\" "
        + "http://127.0.0.1:8080/api/v2/app/setPreferences'";

    public static GluetunHandle AddGluetun(ArrspireContext context)
    {
        (string ContainerName, string InstanceId)? identity =
            context.IsRunMode ? CreateRunIdentity() : null;
        var directAccess = ArrspireResourceExtensions.DirectHostAccessEnabled();
        var resource = context.Builder
            .AddContainer("gluetun", ArrspireImages.Gluetun)
            .WithEnvironment("VPN_SERVICE_PROVIDER", context.Parameters.VpnProvider)
            .WithEnvironment("VPN_TYPE", "wireguard")
            .WithEnvironment("WIREGUARD_PRIVATE_KEY", context.Parameters.VpnWireguardKey)
            .WithEnvironment("SERVER_COUNTRIES", context.Parameters.VpnCountries)
            .WithEnvironment("VPN_PORT_FORWARDING", "on")
            .WithEnvironment("VPN_PORT_FORWARDING_PROVIDER", "protonvpn")
            .WithEnvironment("VPN_PORT_FORWARDING_UP_COMMAND", PortForwardingUpCommand)
            .WithEnvironment("VPN_PORT_FORWARDING_DOWN_COMMAND", PortForwardingDownCommand)
            .WithEnvironment("TZ", context.Parameters.Timezone)
            .WithEnvironment("HTTPPROXY", "on")
            .WithEnvironment("HTTPPROXY_STEALTH", "on")
            .WithBindMount(Path.Combine(context.Paths.Data, "gluetun"), "/gluetun")
            .WithContainerRuntimeArgs(
                "--cap-add=NET_ADMIN",
                "--device=/dev/net/tun:/dev/net/tun")
            .WithHttpEndpoint(targetPort: 8000, name: "control")
            .WithHttpEndpoint(targetPort: 8888, name: "http-proxy")
            .WithEndpoint(
                port: directAccess ? 8080 : null,
                targetPort: 8080,
                scheme: "http",
                name: "qbittorrent",
                isExternal: directAccess)
            .WithEndpoint(
                port: directAccess ? 9696 : null,
                targetPort: 9696,
                scheme: "http",
                name: "prowlarr",
                isExternal: directAccess)
            .PublishAsDockerComposeService((_, service) =>
            {
                service.CapAdd.Add("NET_ADMIN");
                service.Devices.Add("/dev/net/tun:/dev/net/tun");
                service.Restart = "unless-stopped";
            });

        if (identity is not null)
        {
            resource.WithContainerName(identity.Value.ContainerName);
        }

        return new GluetunHandle(
            resource,
            resource.AsResource(),
            resource.GetEndpoint("control"),
            resource.GetEndpoint("http-proxy"),
            resource.GetEndpoint("qbittorrent"),
            resource.GetEndpoint("prowlarr"),
            identity?.ContainerName,
            identity?.InstanceId);
    }

    public static VpnRoutedHandle AddQBittorrent(
        ArrspireContext context,
        GluetunHandle gluetun)
    {
        var mounts = new (string Source, string Target)[]
        {
            (Path.Combine(context.Paths.Data, "qbittorrent"), "/config"),
            (context.Paths.Downloads, "/downloads"),
            (Path.Combine(context.Paths.Media, "movies"), "/movies"),
            (Path.Combine(context.Paths.Media, "tv"), "/tv"),
            (Path.Combine(context.Paths.Media, "music"), "/music"),
        };
        var compose = context.Builder
            .AddContainer("qbittorrent", ArrspireImages.QBittorrent)
            .WithEnvironment("WEBUI_PORT", "8080")
            .WithComposeRestart();
        foreach (var (source, target) in mounts)
        {
            compose.WithBindMount(source, target);
        }

        compose
            .WaitFor(gluetun.Resource)
            .WithLinuxServerDefaults(context)
            .ExposeHttp(8080, "/");

        return AddVpnRouted(
            context,
            gluetun,
            "qbittorrent",
            ArrspireImages.QBittorrent,
            compose,
            gluetun.QBittorrent,
            mounts,
            new Dictionary<string, string> { ["WEBUI_PORT"] = "8080" });
    }

    public static ArrResourceHandle AddProwlarr(
        ArrspireContext context,
        GluetunHandle gluetun)
    {
        var mounts = new (string Source, string Target)[]
        {
            (Path.Combine(context.Paths.Data, "prowlarr"), "/config"),
        };
        var compose = context.Builder
            .AddContainer("prowlarr", ArrspireImages.Prowlarr)
            .WithBindMount(mounts[0].Source, mounts[0].Target)
            .WaitFor(gluetun.Resource)
            .WithLinuxServerDefaults(context)
            .ExposeHttp(9696, "/ping")
            .WithComposeRestart();
        var routed = AddVpnRouted(
            context,
            gluetun,
            "prowlarr",
            ArrspireImages.Prowlarr,
            compose,
            gluetun.Prowlarr,
            mounts);
        return new ArrResourceHandle(
            "prowlarr",
            routed.Resource,
            routed.Http,
            "v1",
            "/data/prowlarr");
    }

    private static VpnRoutedHandle AddVpnRouted(
        ArrspireContext context,
        GluetunHandle gluetun,
        string name,
        string image,
        IResourceBuilder<ContainerResource> compose,
        EndpointReference http,
        IReadOnlyList<(string Source, string Target)> mounts,
        IReadOnlyDictionary<string, string>? environment = null)
    {
        if (!context.IsRunMode)
        {
            compose.ConfigureComposeVpnNetwork(gluetun);
            return new VpnRoutedHandle(name, compose.AsResource(), compose, http);
        }

        compose.WithExplicitStart();
        if (gluetun.RunContainerName is null || gluetun.RunInstanceId is null)
        {
            throw new InvalidOperationException("Gluetun run identity is required in run mode.");
        }

        var runtime = Environment.GetEnvironmentVariable("ASPIRE_CONTAINER_RUNTIME")
            ?? (context.Paths.ContainerSocket.Contains("podman.sock", StringComparison.Ordinal)
                ? "podman"
                : "docker");
        var containerName = $"arrspire-{gluetun.RunInstanceId}-{name}";
        var runArguments = new List<object>
        {
            runtime,
            containerName,
            gluetun.RunContainerName,
            Environment.ProcessId.ToString(),
            "run",
            "--rm",
            "--name",
            containerName,
            "--label",
            $"io.arrspire.instance={gluetun.RunInstanceId}",
            "--label",
            $"io.arrspire.service={name}",
            "--network",
            $"container:{gluetun.RunContainerName}",
        };
        if (runtime == "podman" && context.Paths.RootlessPodman)
        {
            runArguments.Add("--userns=keep-id");
        }

        foreach (var (key, value) in BaseEnvironment(context)
            .Concat(environment ?? new Dictionary<string, string>()))
        {
            runArguments.Add("--env");
            runArguments.Add($"{key}={value}");
        }
        runArguments.Add("--env");
        runArguments.Add(ReferenceExpression.Create($"TZ={context.Parameters.Timezone}"));

        foreach (var (source, target) in mounts)
        {
            runArguments.Add("--volume");
            runArguments.Add($"{source}:{target}");
        }

        runArguments.Add(image);
        var runner = context.Builder
            .AddProject<Projects.Arrspire_ContainerRunner>($"{name}-vpn")
            .WithArgs(runArguments.ToArray())
            .WithRequiredCommand(runtime)
            .WithRequiredCommand("setsid")
            .WaitFor(gluetun.Resource);
        return new VpnRoutedHandle(name, runner.AsResource(), compose, http);
    }

    private static Dictionary<string, string> BaseEnvironment(ArrspireContext context)
        => new(StringComparer.Ordinal)
        {
            ["PUID"] = UnixIdentity.UserId.ToString(),
            ["PGID"] = UnixIdentity.GroupId.ToString(),
        };

    private static (string ContainerName, string InstanceId) CreateRunIdentity()
    {
        var raw = Environment.GetEnvironmentVariable("ARRSPIRE_INSTANCE_ID")
            ?? Guid.NewGuid().ToString("N")[..8];
        var instanceId = InvalidIdentityCharacters().Replace(raw, "-");
        return ($"arrspire-{instanceId}-gluetun", instanceId);
    }

    [GeneratedRegex("[^a-zA-Z0-9_.-]")]
    private static partial Regex InvalidIdentityCharacters();
}
