using Aspire.Hosting.ApplicationModel;
using Aspire.Hosting.Publishing;

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
    internal const string DefaultVpnCountries = "Brazil";

    public static ArrspireParameters AddTo(IDistributedApplicationBuilder builder)
        => new(
            Plain(builder, "vpn-provider", "protonvpn"),
            builder.AddParameter("vpn-wireguard-key", secret: true),
            Plain(builder, "vpn-countries", DefaultVpnCountries),
            Plain(builder, "timezone", "America/Sao_Paulo"),
            Plain(builder, "jellyfin-admin-user", "admin"),
            Generated(builder, "jellyfin-admin-password"),
            Plain(builder, "jellyfin-server-name", "arrspire"),
            Plain(builder, "jellyfin-language", "pt-BR"),
            Generated(builder, "qbittorrent-password"),
            Generated(builder, "duplicati-encryption-key", minimumLength: 32),
            Generated(builder, "duplicati-web-password"),
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

    private static IResourceBuilder<ParameterResource> Plain(
        IDistributedApplicationBuilder builder,
        string name,
        string fallback)
        => builder.AddParameter(
            name,
            new StaticParameterDefault(fallback));

    private static IResourceBuilder<ParameterResource> SecretWithOptionalValue(
        IDistributedApplicationBuilder builder,
        string name)
        => builder.AddParameter(
            name,
            new StaticParameterDefault(string.Empty),
            secret: true);

    private static IResourceBuilder<ParameterResource> Generated(
        IDistributedApplicationBuilder builder,
        string name,
        int minimumLength = 24)
    {
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
}

internal sealed class StaticParameterDefault(string value) : ParameterDefault
{
    public override string GetDefaultValue() => value;

    public override void WriteToManifest(ManifestPublishingContext context)
        => context.Writer.WriteString("value", value);
}
