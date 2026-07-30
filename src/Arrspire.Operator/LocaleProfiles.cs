namespace Arrspire.Operator;

internal static class LocaleProfiles
{
    public static async Task<int> RunAsync(string root, IReadOnlyList<string> args)
    {
        var name = args.FirstOrDefault()
            ?? throw new InvalidOperationException("Choose locale profile pt-BR or neutral.");
        var values = name switch
        {
            "pt-BR" => new Dictionary<string, string>
            {
                ["timezone"] = "America/Sao_Paulo",
                ["jellyfin-language"] = "pt-BR",
                ["subtitle-languages"] = "pt-BR",
            },
            "neutral" => new Dictionary<string, string>
            {
                ["timezone"] = "UTC",
                ["jellyfin-language"] = "en-US",
                ["subtitle-languages"] = "en",
            },
            _ => throw new InvalidOperationException(
                $"Unknown locale profile {name}; choose pt-BR or neutral."),
        };
        foreach (var (parameter, value) in values)
        {
            Console.WriteLine(
                $"{parameter,-24} {value,-24} "
                + $"Parameters__{parameter.Replace('-', '_')}={value}");
        }
        if (!args.Contains("--apply"))
        {
            return 0;
        }
        foreach (var (parameter, value) in values)
        {
            var exitCode = await ProcessRunner.InheritAsync(
                "aspire",
                ["secret", "set", $"Parameters:{parameter}", value, "--non-interactive"],
                root);
            if (exitCode != 0)
            {
                throw new InvalidOperationException(
                    $"Unable to apply locale parameter {parameter}");
            }
        }
        Console.WriteLine($"Applied the {name} locale profile.");
        return 0;
    }
}
