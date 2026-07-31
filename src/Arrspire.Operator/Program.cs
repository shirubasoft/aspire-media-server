using System.CommandLine;
using Arrspire.Operator;

try
{
    var repositoryRoot = Repository.FindRoot(Environment.CurrentDirectory);
    var root = new RootCommand("Operate the Arrspire Aspire application");

    var setup = new Command("setup", "Configure paths and Aspire parameters");
    var nonInteractive = new Option<bool>("--non-interactive");
    setup.Options.Add(nonInteractive);
    setup.SetAction(parse => Setup.RunAsync(
        repositoryRoot,
        parse.GetValue(nonInteractive) ? ["--non-interactive"] : []));
    root.Subcommands.Add(setup);

    root.Subcommands.Add(Action("doctor", "Validate the host and configuration",
        () => Doctor.RunAsync(repositoryRoot)));
    root.Subcommands.Add(Action("allow-lan", "Allow the published HTTPS port through UFW",
        () => Firewall.RunAsync(repositoryRoot)));

    var tls = new Command("tls-local", "Generate and trust local TLS assets");
    var domain = new Argument<string?>("domain") { Arity = ArgumentArity.ZeroOrOne };
    tls.Arguments.Add(domain);
    tls.SetAction(parse => LocalTls.RunAsync(
        repositoryRoot,
        parse.GetValue(domain) is { } value ? [value] : []));
    root.Subcommands.Add(tls);

    var locale = new Command("locale", "Apply a locale profile");
    var localeName = new Argument<string>("profile");
    var apply = new Option<bool>("--apply");
    locale.Arguments.Add(localeName);
    locale.Options.Add(apply);
    locale.SetAction(parse => LocaleProfiles.RunAsync(
        repositoryRoot,
        parse.GetValue(apply)
            ? [parse.GetRequiredValue(localeName), "--apply"]
            : [parse.GetRequiredValue(localeName)]));
    root.Subcommands.Add(locale);

    var cleanup = new Command("cleanup-vpn", "Remove one run's VPN containers");
    var instance = new Argument<string>("instance");
    cleanup.Arguments.Add(instance);
    cleanup.SetAction(parse => VpnCleanup.RunAsync(
        [parse.GetRequiredValue(instance)]));
    root.Subcommands.Add(cleanup);

    foreach (var (name, description) in new[]
    {
        ("publish", "Publish Docker Compose artifacts through Aspire"),
        ("deploy", "Deploy the Docker Compose environment through Aspire"),
        ("down", "Destroy the deployed Aspire environment"),
        ("repair", "Run the deployed reconciliation repair job"),
        ("status", "Show Aspire and persisted reconciliation status"),
    })
    {
        var command = new Command(name, description)
        {
            TreatUnmatchedTokensAsErrors = false,
        };
        var additional = new Argument<string[]>("arguments")
        {
            Arity = ArgumentArity.ZeroOrMore,
        };
        command.Arguments.Add(additional);
        command.SetAction(parse => Deployment.RunAsync(
            repositoryRoot,
            name,
            [.. parse.GetValue(additional) ?? [], .. parse.UnmatchedTokens]));
        root.Subcommands.Add(command);
    }

    Environment.ExitCode = await root.Parse(args).InvokeAsync();
}
catch (Exception exception)
{
    Console.Error.WriteLine($"Arrspire operator failed: {exception.Message}");
    Environment.ExitCode = 1;
}

static Command Action(string name, string description, Func<Task<int>> action)
{
    var command = new Command(name, description);
    command.SetAction(_ => action());
    return command;
}
