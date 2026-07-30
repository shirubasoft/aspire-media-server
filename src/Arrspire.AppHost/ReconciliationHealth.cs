using System.Text.Json;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Arrspire.AppHost;

internal static class ReconciliationHealth
{
    public const string CheckName = "arrspire-reconciliation";

    public static HealthCheckResult Evaluate(string path)
    {
        try
        {
            if (!File.Exists(path))
            {
                return HealthCheckResult.Unhealthy(
                    "Reconciliation has not reported status yet.");
            }
            using var document = JsonDocument.Parse(File.ReadAllText(path));
            var status = document.RootElement.TryGetProperty("status", out var property)
                ? property.GetString()
                : null;
            return status switch
            {
                "ready" => HealthCheckResult.Healthy(
                    "All required integrations are reconciled."),
                "attention" => HealthCheckResult.Healthy(
                    "Required integrations are ready; optional integrations need attention."),
                "failed" => HealthCheckResult.Unhealthy(
                    "One or more required integrations failed."),
                "pending" => HealthCheckResult.Unhealthy(
                    "Reconciliation is waiting for services or applying configuration."),
                _ => HealthCheckResult.Unhealthy(
                    $"Unknown reconciliation status: {status ?? "missing"}"),
            };
        }
        catch (Exception exception) when (
            exception is IOException
                or UnauthorizedAccessException
                or JsonException)
        {
            return HealthCheckResult.Unhealthy(
                "Unable to read reconciliation status.",
                exception);
        }
    }
}
