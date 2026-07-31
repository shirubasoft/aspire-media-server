using System.Text;
using System.Text.RegularExpressions;
using Arrspire.AppHost;

namespace Arrspire.Operator;

internal static partial class LocalTls
{
    private static readonly string[] ServiceNames =
    [
        "auth", "jellyfin", "jellyseerr", "seerr", "sonarr", "radarr",
        "lidarr", "prowlarr", "bazarr", "qbittorrent", "duplicati", "tdarr",
        "prometheus", "grafana", "traefik",
    ];

    public static async Task<int> RunAsync(string root, IReadOnlyList<string> args)
    {
        var tlsMode = Environment.GetEnvironmentVariable(
                "Parameters__traefik_tls_mode")
            ?? "local";
        ValidateMode(tlsMode);
        var domain = args.FirstOrDefault()
            ?? Environment.GetEnvironmentVariable("Parameters__traefik_domain")
            ?? Ingress.DefaultTraefikDomain;
        ValidateDomain(domain);
        var paths = ArrspirePaths.Resolve(Path.Combine(root, "Arrspire.AppHost"));
        var certificateDirectory = Path.Combine(
            paths.Data, "traefik", "dynamic", "certs");
        Directory.CreateDirectory(certificateDirectory);
        var caKey = Path.Combine(certificateDirectory, "arrspire-local-ca.key");
        var caCertificate = Path.Combine(certificateDirectory, "arrspire-local-ca.crt");
        var key = Path.Combine(certificateDirectory, "arrspire-local.key");
        var certificate = Path.Combine(certificateDirectory, "arrspire-local.crt");
        var request = Path.Combine(certificateDirectory, "arrspire-local.csr");
        var config = Path.Combine(certificateDirectory, "openssl.cnf");
        var marker = Path.Combine(certificateDirectory, "domain");
        if (!File.Exists(caKey) || !File.Exists(caCertificate))
        {
            Require(await ProcessRunner.InheritAsync(
                "openssl", ["genrsa", "-out", caKey, "4096"], root), "generate CA key");
            Require(await ProcessRunner.InheritAsync(
                "openssl",
                [
                    "req", "-x509", "-new", "-key", caKey, "-sha256", "-days", "3650",
                    "-subj", "/CN=Arrspire Local CA", "-out", caCertificate,
                ],
                root),
                "generate CA certificate");
        }

        var previousDomain = File.Exists(marker)
            ? (await File.ReadAllTextAsync(marker)).Trim()
            : "";
        if (previousDomain != domain || !File.Exists(key) || !File.Exists(certificate))
        {
            await File.WriteAllTextAsync(config, OpenSslConfiguration(domain));
            Require(await ProcessRunner.InheritAsync(
                "openssl", ["genrsa", "-out", key, "4096"], root), "generate TLS key");
            Require(await ProcessRunner.InheritAsync(
                "openssl",
                ["req", "-new", "-key", key, "-out", request, "-config", config],
                root),
                "generate TLS request");
            Require(await ProcessRunner.InheritAsync(
                "openssl",
                [
                    "x509", "-req", "-in", request, "-CA", caCertificate,
                    "-CAkey", caKey, "-CAcreateserial", "-out", certificate,
                    "-days", "825", "-sha256", "-extensions", "v3_req",
                    "-extfile", config,
                ],
                root),
                "sign TLS certificate");
            await File.WriteAllTextAsync(marker, domain + "\n");
            File.Delete(request);
            File.Delete(config);
        }

        var dynamic = Path.GetDirectoryName(certificateDirectory)
            ?? throw new InvalidOperationException("TLS directory has no parent");
        await File.WriteAllTextAsync(
            Path.Combine(dynamic, "tls.yml"),
            """
            tls:
              certificates:
                - certFile: /etc/traefik/dynamic/certs/arrspire-local.crt
                  keyFile: /etc/traefik/dynamic/certs/arrspire-local.key
              stores:
                default:
                  defaultCertificate:
                    certFile: /etc/traefik/dynamic/certs/arrspire-local.crt
                    keyFile: /etc/traefik/dynamic/certs/arrspire-local.key

            """);
        ProtectPrivate(caKey);
        ProtectPrivate(key);
        await TrustBrowserAsync(root, caCertificate);
        Console.WriteLine($"Configured Traefik local TLS for *.{domain}.");
        return 0;
    }

    internal static string OpenSslConfiguration(string domain)
    {
        ValidateDomain(domain);
        var hostnames = new[] { $"*.{domain}", domain }
            .Concat(ServiceNames.Select(service => $"{service}.{domain}"));
        var alternateNames = string.Join(
            "\n",
            hostnames.Select((hostname, index) => $"DNS.{index + 1} = {hostname}"));
        return $"""
                [req]
                distinguished_name = subject
                req_extensions = v3_req
                prompt = no

                [subject]
                CN = *.{domain}

                [v3_req]
                basicConstraints = CA:FALSE
                keyUsage = critical, digitalSignature, keyEncipherment
                extendedKeyUsage = serverAuth
                subjectAltName = @alt_names

                [alt_names]
                {alternateNames}

                """;
    }

    internal static void ValidateDomain(string domain)
    {
        if (domain.Length > 253 || !DomainRegex().IsMatch(domain))
        {
            throw new InvalidOperationException($"Invalid local TLS domain: {domain}");
        }
    }

    internal static void ValidateMode(string mode)
    {
        if (mode != "local")
        {
            throw new InvalidOperationException(
                $"Local CA generation is disabled when traefik-tls-mode is {mode}");
        }
    }

    private static async Task TrustBrowserAsync(string root, string caCertificate)
    {
        var nss = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".pki",
            "nssdb");
        Directory.CreateDirectory(nss);
        if (!File.Exists(Path.Combine(nss, "cert9.db")))
        {
            var initialized = await ProcessRunner.CaptureAsync(
                "certutil", ["-N", "--empty-password", "-d", $"sql:{nss}"], root);
            if (initialized.ExitCode != 0)
            {
                Console.WriteLine("Browser trust was not installed: certutil is unavailable.");
                return;
            }
        }
        _ = await ProcessRunner.CaptureAsync(
            "certutil", ["-D", "-d", $"sql:{nss}", "-n", "Arrspire Local CA"], root);
        var added = await ProcessRunner.CaptureAsync(
            "certutil",
            [
                "-A", "-d", $"sql:{nss}", "-n", "Arrspire Local CA",
                "-t", "C,,", "-i", caCertificate,
            ],
            root);
        if (added.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"Unable to trust local CA: {added.StandardError.Trim()}");
        }
    }

    private static void ProtectPrivate(string path)
    {
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(
                path,
                UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
    }

    private static void Require(int exitCode, string operation)
    {
        if (exitCode != 0)
        {
            throw new InvalidOperationException($"Unable to {operation}");
        }
    }

    [GeneratedRegex("^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$")]
    private static partial Regex DomainRegex();
}
