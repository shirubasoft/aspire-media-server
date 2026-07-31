using System.Globalization;
using System.Net.Mail;
using System.Text.RegularExpressions;

namespace Arrspire.ControlPlane;

internal sealed record OptionalCredentialState(
    string Name,
    bool Configured,
    string? Reason = null);

internal static partial class Validation
{
    private static readonly (string Provider, string User, string Password)[] OptionalPairs =
    [
        ("OpenSubtitles.com", "OPENSUBTITLESCOM_USER", "OPENSUBTITLESCOM_PASSWORD"),
        ("OpenSubtitles.org", "OPENSUBTITLESORG_USER", "OPENSUBTITLESORG_PASSWORD"),
        ("LegendasDivx", "LEGENDASDIVX_USER", "LEGENDASDIVX_PASSWORD"),
        ("Legendas.net", "LEGENDASNET_USER", "LEGENDASNET_PASSWORD"),
    ];

    public static void ValidateConfiguration(
        IReadOnlyDictionary<string, string?> environment)
    {
        var provider = Required(environment, "VPN_PROVIDER");
        if (!VpnProviderRegex().IsMatch(provider) || provider == "custom")
        {
            throw new InvalidOperationException(
                $"VPN_PROVIDER must be a supported lowercase Gluetun provider identifier; received {provider}");
        }

        var countries = Required(environment, "VPN_COUNTRIES").Split(',');
        if (countries.Any(country => !CountryRegex().IsMatch(country.Trim())))
        {
            throw new InvalidOperationException(
                "VPN_COUNTRIES must be a comma-separated list of full Gluetun country names");
        }

        ValidateWireguardKey(Required(environment, "VPN_WIREGUARD_KEY"));
        ValidateTimezone(Required(environment, "TIMEZONE"));
        ValidateLocale("JELLYFIN_LANGUAGE", Required(environment, "JELLYFIN_LANGUAGE"));
        var languages = Required(environment, "SUBTITLE_LANGUAGES").Split(',');
        if (languages.Any(language => string.IsNullOrWhiteSpace(language)))
        {
            throw new InvalidOperationException(
                "SUBTITLE_LANGUAGES must be a comma-separated list without empty entries");
        }

        foreach (var language in languages)
        {
            ValidateLocale("SUBTITLE_LANGUAGES", language.Trim());
        }

        if (!int.TryParse(Required(environment, "MINIMUM_SEEDERS"), out var seeders)
            || seeders < 0)
        {
            throw new InvalidOperationException(
                "MINIMUM_SEEDERS must be a non-negative integer");
        }

        if (Required(environment, "USE_ORIGINAL_TITLE").ToLowerInvariant()
            is not ("true" or "false"))
        {
            throw new InvalidOperationException("USE_ORIGINAL_TITLE must be true or false");
        }

        var domain = Required(environment, "TRAEFIK_DOMAIN");
        if (!DomainRegex().IsMatch(domain))
        {
            throw new InvalidOperationException(
                "TRAEFIK_DOMAIN must be a fully qualified lowercase domain "
                + $"so the shared sign-in cookie is valid; received {domain}");
        }

        ValidateTls(environment, domain);
        if (!AdminUserRegex().IsMatch(Required(environment, "INGRESS_ADMIN_USER")))
        {
            throw new InvalidOperationException(
                "INGRESS_ADMIN_USER must be 1-64 letters, numbers, dots, underscores, or hyphens");
        }

        _ = Required(environment, "INGRESS_ADMIN_PASSWORD");
        foreach (var name in new[]
        {
            "AUTHELIA_SESSION_SECRET",
            "AUTHELIA_STORAGE_ENCRYPTION_KEY",
        })
        {
            if (Required(environment, name).Length < 64)
            {
                throw new InvalidOperationException($"{name} must be at least 64 characters");
            }
        }

        ValidateOptionalCredentialPairs(environment);
    }

    public static void ValidateOptionalCredentialPairs(
        IReadOnlyDictionary<string, string?> environment)
    {
        foreach (var pair in OptionalPairs)
        {
            var hasUser = Value(environment, pair.User).Length > 0;
            var hasPassword = Value(environment, pair.Password).Length > 0;
            if (hasUser != hasPassword)
            {
                throw new InvalidOperationException(
                    $"{pair.Provider} is optional, but {pair.User} and {pair.Password} "
                    + "must either both be set or both be empty");
            }
        }
    }

    public static IReadOnlyList<OptionalCredentialState> OptionalCredentialStates(
        IReadOnlyDictionary<string, string?> environment)
    {
        return OptionalPairs.Select(pair =>
        {
            var configured = Value(environment, pair.User).Length > 0
                && Value(environment, pair.Password).Length > 0;
            return configured
                ? new OptionalCredentialState(pair.Provider, true)
                : new OptionalCredentialState(
                    pair.Provider,
                    false,
                    $"{pair.User} and {pair.Password} were not supplied");
        }).ToArray();
    }

    public static void ValidateWireguardKey(string key)
    {
        byte[] decoded;
        try
        {
            decoded = Convert.FromBase64String(key);
        }
        catch (Exception exception) when (exception is FormatException or ArgumentException)
        {
            throw new InvalidOperationException(
                "VPN_WIREGUARD_KEY must be a base64 WireGuard private key",
                exception);
        }

        if (decoded.Length != 32
            || Convert.ToBase64String(decoded).TrimEnd('=')
                != key.TrimEnd('='))
        {
            throw new InvalidOperationException(
                "VPN_WIREGUARD_KEY must decode to exactly 32 bytes; create a "
                + "WireGuard configuration in your VPN provider portal");
        }
    }

    internal static string ResolveTlsMode(IReadOnlyDictionary<string, string?> environment)
    {
        var mode = Value(environment, "TRAEFIK_TLS_MODE");
        mode = mode.Length == 0 ? "local" : mode;
        return mode is "local" or "cloudflare-acme"
            ? mode
            : throw new InvalidOperationException(
                $"TRAEFIK_TLS_MODE must be one of local, cloudflare-acme; received {mode}");
    }

    private static void ValidateTls(
        IReadOnlyDictionary<string, string?> environment,
        string domain)
    {
        if (ResolveTlsMode(environment) == "local")
        {
            return;
        }

        if (domain == "localhost")
        {
            throw new InvalidOperationException(
                "TRAEFIK_DOMAIN must be publicly registered for cloudflare-acme");
        }

        try
        {
            var address = new MailAddress(Value(environment, "TRAEFIK_ACME_EMAIL"));
            if (address.Address.Length > 254)
            {
                throw new FormatException();
            }
        }
        catch (Exception exception) when (exception is FormatException or ArgumentException)
        {
            throw new InvalidOperationException(
                "TRAEFIK_ACME_EMAIL must be a valid contact email for cloudflare-acme",
                exception);
        }

        if (Value(environment, "CF_DNS_API_TOKEN").Length == 0)
        {
            throw new InvalidOperationException(
                "CF_DNS_API_TOKEN is required for cloudflare-acme");
        }
    }

    private static void ValidateTimezone(string timezone)
    {
        try
        {
            _ = TimeZoneInfo.FindSystemTimeZoneById(timezone);
        }
        catch (TimeZoneNotFoundException exception)
        {
            throw new InvalidOperationException(
                $"TIMEZONE must be an IANA timezone; received {timezone}",
                exception);
        }
    }

    private static void ValidateLocale(string name, string locale)
    {
        try
        {
            _ = CultureInfo.GetCultureInfo(locale);
        }
        catch (CultureNotFoundException exception)
        {
            throw new InvalidOperationException(
                $"{name} must contain a BCP 47 language tag; received {locale}",
                exception);
        }
    }

    private static string Required(
        IReadOnlyDictionary<string, string?> environment,
        string name)
        => Value(environment, name) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"{name} is required");

    private static string Value(
        IReadOnlyDictionary<string, string?> environment,
        string name)
        => environment.TryGetValue(name, out var value) ? value?.Trim() ?? "" : "";

    [GeneratedRegex("^[a-z0-9][a-z0-9-]*$")]
    private static partial Regex VpnProviderRegex();

    [GeneratedRegex(@"^[\p{L}\p{M}][\p{L}\p{M} .'-]*$")]
    private static partial Regex CountryRegex();

    [GeneratedRegex(
        @"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")]
    private static partial Regex DomainRegex();

    [GeneratedRegex("^[A-Za-z0-9._-]{1,64}$")]
    private static partial Regex AdminUserRegex();
}
