using Aspire.Hosting.ApplicationModel;
using Microsoft.Extensions.Configuration;

namespace Arrspire.AppHost;

internal sealed record ArrspireParameters(
    IResourceBuilder<ParameterResource> VpnProvider,
    IResourceBuilder<ParameterResource> VpnWireguardKey,
    IResourceBuilder<ParameterResource> VpnCountries,
    IResourceBuilder<ParameterResource> Timezone,
    IResourceBuilder<ParameterResource> JellyfinAdminUser,
    IResourceBuilder<ParameterResource> JellyfinAdminPassword,
    IResourceBuilder<ParameterResource> JellyfinServerName,
    IResourceBuilder<ParameterResource> JellyfinLanguage,
    IResourceBuilder<ParameterResource> QBittorrentPassword,
    IResourceBuilder<ParameterResource> DuplicatiEncryptionKey,
    IResourceBuilder<ParameterResource> DuplicatiWebPassword,
    IResourceBuilder<ParameterResource> GrafanaAdminPassword,
    IResourceBuilder<ParameterResource> SubtitleLanguages,
    IResourceBuilder<ParameterResource> UseOriginalTitle,
    IResourceBuilder<ParameterResource> MinimumSeeders,
    IResourceBuilder<ParameterResource> TraefikDomain,
    IResourceBuilder<ParameterResource> TraefikTlsMode,
    IResourceBuilder<ParameterResource> TraefikAcmeEmail,
    IResourceBuilder<ParameterResource> CloudflareDnsApiToken,
    IResourceBuilder<ParameterResource> IngressAdminUser,
    IResourceBuilder<ParameterResource> IngressAdminPassword,
    IResourceBuilder<ParameterResource> AutheliaSessionSecret,
    IResourceBuilder<ParameterResource> AutheliaStorageEncryptionKey,
    IResourceBuilder<ParameterResource> NtfyEndpoint,
    IResourceBuilder<ParameterResource> NtfyTopic,
    IResourceBuilder<ParameterResource> NtfyToken,
    IResourceBuilder<ParameterResource> OpensubtitlesComUser,
    IResourceBuilder<ParameterResource> OpensubtitlesComPassword,
    IResourceBuilder<ParameterResource> OpensubtitlesOrgUser,
    IResourceBuilder<ParameterResource> OpensubtitlesOrgPassword,
    IResourceBuilder<ParameterResource> LegendasDivxUser,
    IResourceBuilder<ParameterResource> LegendasDivxPassword,
    IResourceBuilder<ParameterResource> LegendasNetUser,
    IResourceBuilder<ParameterResource> LegendasNetPassword)
{
    public static ArrspireParameters AddTo(IDistributedApplicationBuilder builder)
        => new(
            Plain(builder, "vpn-provider", "protonvpn"),
            builder.AddParameter("vpn-wireguard-key", secret: true),
            Plain(builder, "vpn-countries", "Netherlands"),
            Plain(builder, "timezone", "America/Sao_Paulo"),
            Plain(builder, "jellyfin-admin-user", "admin"),
            Generated(builder, "jellyfin-admin-password"),
            Plain(builder, "jellyfin-server-name", "arrspire"),
            Plain(builder, "jellyfin-language", "pt-BR"),
            Generated(builder, "qbittorrent-password"),
            Generated(builder, "duplicati-encryption-key", minimumLength: 32),
            Generated(builder, "duplicati-web-password"),
            Generated(builder, "grafana-admin-password"),
            Plain(builder, "subtitle-languages", "pt-BR"),
            Plain(builder, "use-original-title", "false"),
            Plain(builder, "minimum-seeders", "1"),
            Plain(builder, "traefik-domain", Ingress.DefaultTraefikDomain),
            Plain(builder, "traefik-tls-mode", "local"),
            Plain(builder, "traefik-acme-email", string.Empty),
            SecretWithOptionalValue(builder, "cloudflare-dns-api-token"),
            Plain(builder, "ingress-admin-user", "admin"),
            Generated(builder, "ingress-admin-password"),
            Generated(builder, "authelia-session-secret", minimumLength: 64),
            Generated(builder, "authelia-storage-encryption-key", minimumLength: 64),
            Plain(builder, "ntfy-endpoint", "https://ntfy.sh"),
            SecretWithOptionalValue(builder, "ntfy-topic"),
            SecretWithOptionalValue(builder, "ntfy-token"),
            Plain(builder, "opensubtitlescom-user", string.Empty),
            SecretWithOptionalValue(builder, "opensubtitlescom-password"),
            Plain(builder, "opensubtitlesorg-user", string.Empty),
            SecretWithOptionalValue(builder, "opensubtitlesorg-password"),
            Plain(builder, "legendasdivx-user", string.Empty),
            SecretWithOptionalValue(builder, "legendasdivx-password"),
            Plain(builder, "legendasnet-user", string.Empty),
            SecretWithOptionalValue(builder, "legendasnet-password"));

    public static string ParameterValue(
        string name,
        string fallback,
        IReadOnlyDictionary<string, string?>? environment = null)
    {
        environment ??= Environment.GetEnvironmentVariables()
            .Cast<System.Collections.DictionaryEntry>()
            .ToDictionary(
                entry => (string)entry.Key,
                entry => entry.Value?.ToString(),
                StringComparer.Ordinal);
        var environmentName = $"Parameters__{name.Replace('-', '_')}";
        return environment.TryGetValue(environmentName, out var value) && value is not null
            ? value
            : fallback;
    }

    private static IResourceBuilder<ParameterResource> Plain(
        IDistributedApplicationBuilder builder,
        string name,
        string fallback)
        => builder.AddParameter(
            name,
            ConfiguredValue(builder, name, fallback),
            publishValueAsDefault: true);

    private static IResourceBuilder<ParameterResource> SecretWithOptionalValue(
        IDistributedApplicationBuilder builder,
        string name)
        => builder.AddParameter(
            name,
            ConfiguredValue(builder, name, string.Empty),
            publishValueAsDefault: false,
            secret: true);

    private static IResourceBuilder<ParameterResource> Generated(
        IDistributedApplicationBuilder builder,
        string name,
        int minimumLength = 24)
    {
        var configured = ConfiguredValue(builder, name, string.Empty);
        if (configured.Length > 0)
        {
            return builder.AddParameter(
                name,
                configured,
                publishValueAsDefault: false,
                secret: true);
        }

        return builder.AddParameter(
            name,
            new GenerateParameterDefault
            {
                MinLength = minimumLength,
                Lower = true,
                Upper = true,
                Numeric = true,
                Special = false,
                MinLower = 4,
                MinUpper = 4,
                MinNumeric = 4,
            },
            secret: true,
            persist: true);
    }

    private static string ConfiguredValue(
        IDistributedApplicationBuilder builder,
        string name,
        string fallback)
        => ConfiguredValue(builder.Configuration, name, fallback);

    internal static string ConfiguredValue(
        IConfiguration configuration,
        string name,
        string fallback,
        IReadOnlyDictionary<string, string?>? environment = null)
    {
        environment ??= Environment.GetEnvironmentVariables()
            .Cast<System.Collections.DictionaryEntry>()
            .ToDictionary(
                entry => (string)entry.Key,
                entry => entry.Value?.ToString(),
                StringComparer.Ordinal);
        environment.TryGetValue(
            $"Parameters__{name.Replace('-', '_')}",
            out var environmentValue);
        return environmentValue
            ?? configuration[$"Parameters:{name}"]
            ?? fallback;
    }
}
