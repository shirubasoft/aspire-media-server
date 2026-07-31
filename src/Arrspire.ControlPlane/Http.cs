using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Arrspire.ControlPlane;

internal sealed class HttpFailure(
    HttpStatusCode status,
    Uri url,
    string responseBody)
    : Exception($"HTTP {(int)status} from {url}: "
        + (responseBody.Length > 240 ? responseBody[..240] : responseBody))
{
    public HttpStatusCode Status { get; } = status;
    public Uri Url { get; } = url;
    public string ResponseBody { get; } = responseBody;
}

internal static class Http
{
    public static async Task<HttpResponseMessage> SendAsync(
        HttpClient client,
        HttpMethod method,
        string url,
        HttpContent? content = null,
        IReadOnlyDictionary<string, string>? headers = null,
        IReadOnlyCollection<HttpStatusCode>? expected = null,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(method, url) { Content = content };
        foreach (var (name, value) in headers ?? new Dictionary<string, string>())
        {
            request.Headers.TryAddWithoutValidation(name, value);
        }

        var response = await client.SendAsync(request, cancellationToken);
        expected ??=
        [
            HttpStatusCode.OK,
            HttpStatusCode.Created,
            HttpStatusCode.Accepted,
            HttpStatusCode.NoContent,
        ];
        if (!expected.Contains(response.StatusCode))
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            response.Dispose();
            throw new HttpFailure(response.StatusCode, new Uri(url), body);
        }

        return response;
    }

    public static async Task<JsonNode> JsonAsync(
        HttpClient client,
        HttpMethod method,
        string url,
        JsonNode? body = null,
        IReadOnlyDictionary<string, string>? headers = null,
        CancellationToken cancellationToken = default)
    {
        using var content = body is null
            ? null
            : new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
        using var response = await SendAsync(
            client,
            method,
            url,
            content,
            headers,
            cancellationToken: cancellationToken);
        return JsonNode.Parse(await response.Content.ReadAsStringAsync(cancellationToken))
            ?? throw new JsonException($"Empty JSON response from {url}");
    }

    public static FormUrlEncodedContent Form(IEnumerable<KeyValuePair<string, string>> values)
        => new(values);
}
