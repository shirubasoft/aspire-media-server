using Microsoft.Extensions.Options;

namespace Arrspire.ControlPlane;

internal sealed record ControlPlaneOptions
{
    public const string SectionName = "Arrspire";

    public string VpnProvider { get; init; } = "";
    public string VpnWireguardKey { get; init; } = "";
    public string VpnCountries { get; init; } = "";
    public string Timezone { get; init; } = "";
    public string JellyfinAdminUser { get; init; } = "";
    public string JellyfinAdminPassword { get; init; } = "";
    public string JellyfinServerName { get; init; } = "";
    public string JellyfinLanguage { get; init; } = "";
    public string QBittorrentPassword { get; init; } = "";
    public string DuplicatiEncryptionKey { get; init; } = "";
    public string DuplicatiWebPassword { get; init; } = "";
    public string SubtitleLanguages { get; init; } = "";
    public bool UseOriginalTitle { get; init; }
    public int MinimumSeeders { get; init; } = 1;
    public string TraefikDomain { get; init; } = "";
    public string TraefikTlsMode { get; init; } = "local";
    public string TraefikAcmeEmail { get; init; } = "";
    public string CloudflareDnsApiToken { get; init; } = "";
    public int TraefikHttpsPort { get; init; } = 443;
    public int IngressHttpsPort { get; init; } = 443;
    public string IngressAdminUser { get; init; } = "";
    public string IngressAdminPassword { get; init; } = "";
    public string AutheliaSessionSecret { get; init; } = "";
    public string AutheliaStorageEncryptionKey { get; init; } = "";
    public string OpensubtitlesComUser { get; init; } = "";
    public string OpensubtitlesComPassword { get; init; } = "";
    public string OpensubtitlesOrgUser { get; init; } = "";
    public string OpensubtitlesOrgPassword { get; init; } = "";
    public string LegendasDivxUser { get; init; } = "";
    public string LegendasDivxPassword { get; init; } = "";
    public string LegendasNetUser { get; init; } = "";
    public string LegendasNetPassword { get; init; } = "";

    public IReadOnlyDictionary<string, string?> ToValidationValues()
        => new Dictionary<string, string?>(StringComparer.Ordinal)
        {
            ["VPN_PROVIDER"] = VpnProvider,
            ["VPN_WIREGUARD_KEY"] = VpnWireguardKey,
            ["VPN_COUNTRIES"] = VpnCountries,
            ["TIMEZONE"] = Timezone,
            ["JELLYFIN_LANGUAGE"] = JellyfinLanguage,
            ["SUBTITLE_LANGUAGES"] = SubtitleLanguages,
            ["MINIMUM_SEEDERS"] = MinimumSeeders.ToString(
                System.Globalization.CultureInfo.InvariantCulture),
            ["USE_ORIGINAL_TITLE"] = UseOriginalTitle.ToString().ToLowerInvariant(),
            ["TRAEFIK_DOMAIN"] = TraefikDomain,
            ["TRAEFIK_TLS_MODE"] = TraefikTlsMode,
            ["TRAEFIK_ACME_EMAIL"] = TraefikAcmeEmail,
            ["CF_DNS_API_TOKEN"] = CloudflareDnsApiToken,
            ["INGRESS_ADMIN_USER"] = IngressAdminUser,
            ["INGRESS_ADMIN_PASSWORD"] = IngressAdminPassword,
            ["AUTHELIA_SESSION_SECRET"] = AutheliaSessionSecret,
            ["AUTHELIA_STORAGE_ENCRYPTION_KEY"] = AutheliaStorageEncryptionKey,
            ["OPENSUBTITLESCOM_USER"] = OpensubtitlesComUser,
            ["OPENSUBTITLESCOM_PASSWORD"] = OpensubtitlesComPassword,
            ["OPENSUBTITLESORG_USER"] = OpensubtitlesOrgUser,
            ["OPENSUBTITLESORG_PASSWORD"] = OpensubtitlesOrgPassword,
            ["LEGENDASDIVX_USER"] = LegendasDivxUser,
            ["LEGENDASDIVX_PASSWORD"] = LegendasDivxPassword,
            ["LEGENDASNET_USER"] = LegendasNetUser,
            ["LEGENDASNET_PASSWORD"] = LegendasNetPassword,
        };
}

internal sealed record ServiceEndpointOptions
{
    public const string SectionName = "Services";

    public string GluetunProxy { get; init; } = "";
    public string Ingress { get; init; } = "";
    public string Notifier { get; init; } = "";
    public string Sonarr { get; init; } = "";
    public string Radarr { get; init; } = "";
    public string Lidarr { get; init; } = "";
    public string Prowlarr { get; init; } = "";
    public string Bazarr { get; init; } = "";
    public string Jellyfin { get; init; } = "";
    public string Seerr { get; init; } = "";
    public string QBittorrent { get; init; } = "";
    public string Tdarr { get; init; } = "";
    public string Duplicati { get; init; } = "";
    public string Homepage { get; init; } = "";
    public string Auth { get; init; } = "";
    public string AspireDashboard { get; init; } = "http://arrspire-dashboard:18888";

    public ServiceUrls ToServiceUrls() => new(
        GluetunProxy,
        Sonarr,
        Radarr,
        Lidarr,
        Prowlarr,
        Bazarr,
        Jellyfin,
        Seerr,
        QBittorrent,
        Tdarr,
        Duplicati);
}

internal enum ControlPlaneMode
{
    Bootstrap,
    Reconcile,
    Verify,
}

internal sealed class ControlPlaneOptionsValidator(ControlPlaneMode mode)
    : IValidateOptions<ControlPlaneOptions>
{
    public ValidateOptionsResult Validate(string? name, ControlPlaneOptions options)
    {
        try
        {
            if (mode == ControlPlaneMode.Bootstrap)
            {
                Validation.ValidateConfiguration(options.ToValidationValues());
                Required(options.QBittorrentPassword, nameof(options.QBittorrentPassword));
            }
            else if (mode == ControlPlaneMode.Reconcile)
            {
                foreach (var (value, property) in new[]
                {
                    (options.QBittorrentPassword, nameof(options.QBittorrentPassword)),
                    (options.JellyfinAdminUser, nameof(options.JellyfinAdminUser)),
                    (options.JellyfinAdminPassword, nameof(options.JellyfinAdminPassword)),
                    (options.JellyfinServerName, nameof(options.JellyfinServerName)),
                    (options.JellyfinLanguage, nameof(options.JellyfinLanguage)),
                    (options.DuplicatiWebPassword, nameof(options.DuplicatiWebPassword)),
                    (options.DuplicatiEncryptionKey, nameof(options.DuplicatiEncryptionKey)),
                    (options.SubtitleLanguages, nameof(options.SubtitleLanguages)),
                    (options.TraefikDomain, nameof(options.TraefikDomain)),
                })
                {
                    Required(value, property);
                }

                if (options.MinimumSeeders < 0)
                {
                    throw new InvalidOperationException(
                        "Arrspire:MinimumSeeders must be non-negative");
                }
                Validation.ValidateOptionalCredentialPairs(
                    options.ToValidationValues());
            }
            else
            {
                Required(options.QBittorrentPassword, nameof(options.QBittorrentPassword));
                Required(options.TraefikDomain, nameof(options.TraefikDomain));
            }

            return ValidateOptionsResult.Success;
        }
        catch (InvalidOperationException exception)
        {
            return ValidateOptionsResult.Fail(exception.Message);
        }
    }

    private static void Required(string value, string property)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidOperationException(
                $"Arrspire:{property} is required for this operation");
        }
    }
}

internal sealed class ServiceEndpointOptionsValidator(ControlPlaneMode mode)
    : IValidateOptions<ServiceEndpointOptions>
{
    public ValidateOptionsResult Validate(string? name, ServiceEndpointOptions options)
    {
        var required = mode switch
        {
            ControlPlaneMode.Bootstrap => new[]
            {
                options.Auth, options.Bazarr, options.Duplicati, options.Homepage,
                options.Jellyfin, options.Seerr, options.Lidarr, options.Prowlarr,
                options.QBittorrent, options.Radarr, options.Sonarr, options.Tdarr,
            },
            ControlPlaneMode.Reconcile => new[]
            {
                options.GluetunProxy, options.Sonarr, options.Radarr, options.Lidarr,
                options.Prowlarr, options.Bazarr, options.Jellyfin, options.Seerr,
                options.QBittorrent, options.Tdarr, options.Duplicati,
            },
            _ => new[]
            {
                options.Ingress, options.Sonarr, options.Radarr, options.Lidarr,
                options.Prowlarr, options.Bazarr, options.Jellyfin, options.Seerr,
                options.QBittorrent,
            },
        };
        return required.All(value => Uri.TryCreate(value, UriKind.Absolute, out _))
            ? ValidateOptionsResult.Success
            : ValidateOptionsResult.Fail(
                "Every Services endpoint required by this operation must be an absolute URI");
    }
}
