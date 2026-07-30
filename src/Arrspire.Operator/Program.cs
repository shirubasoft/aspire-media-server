using Arrspire.Operator;

try
{
    var root = Repository.FindRoot(Environment.CurrentDirectory);
    var command = args.FirstOrDefault() ?? "help";
    var commandArgs = args.Skip(1).ToArray();
    var exitCode = command switch
    {
        "setup" => await Setup.RunAsync(root, commandArgs),
        "doctor" => await Doctor.RunAsync(root),
        "tls-local" => await LocalTls.RunAsync(root, commandArgs),
        "locale" => await LocaleProfiles.RunAsync(root, commandArgs),
        "cleanup-vpn" => await VpnCleanup.RunAsync(commandArgs),
        "allow-lan" => await Firewall.RunAsync(root),
        "publish" or "deploy" or "down" or "repair" or "status"
            => await Deployment.RunAsync(root, command, commandArgs),
        "help" or "--help" or "-h" => Help(),
        _ => throw new InvalidOperationException($"Unknown operator command: {command}"),
    };
    Environment.ExitCode = exitCode;
}
catch (Exception exception)
{
    Console.Error.WriteLine($"Arrspire operator failed: {exception.Message}");
    Environment.ExitCode = 1;
}

static int Help()
{
    Console.WriteLine(
        """
        Arrspire operator

          setup [--non-interactive]  Configure paths and Aspire parameters
          doctor                    Validate the host and configuration
          tls-local [domain]        Generate and trust local TLS assets
          locale <pt-BR|neutral> [--apply]
          allow-lan                 Allow the published HTTPS port through UFW
          cleanup-vpn <instance>    Remove only one run's VPN containers
          publish|deploy|down|repair|status
        """);
    return 0;
}
