using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace Vestra.Providers;
public sealed record BinaryFetchResponse(int Status, string Url, Dictionary<string,string> Headers, byte[] Body, string StatusText);

/// <summary>HTTPS only; exact grants; every redirect and connected address checked.</summary>
public sealed class ProviderHttpTransport : IProviderTransport, IDisposable
{
    private readonly HttpClient client;

    public ProviderHttpTransport()
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
            UseProxy = false,
            AutomaticDecompression = DecompressionMethods.All,
            MaxResponseHeadersLength = 32,
            ConnectTimeout = TimeSpan.FromSeconds(5),
            PooledConnectionLifetime = TimeSpan.FromMinutes(2),
            ConnectCallback = ConnectPublicAsync
        };
        client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Vestra/0.1");
    }

    public async Task<FetchResponse> FetchAsync(FetchRequest request, IReadOnlySet<string> hosts, CancellationToken cancellationToken)
    {
        var r=await FetchBinaryAsync(request,hosts,cancellationToken);
        var encoding=Encoding.UTF8;
        if(r.Headers.TryGetValue("Content-Type",out var type))
        {
            var match=System.Text.RegularExpressions.Regex.Match(type,"charset=([^; ]+)",System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            if(match.Success)try{encoding=Encoding.GetEncoding(match.Groups[1].Value.Trim('"'));}catch(ArgumentException){}
        }
        return new FetchResponse(r.Status,r.Url,r.Headers,encoding.GetString(r.Body),r.StatusText);
    }
    public async Task<BinaryFetchResponse> FetchBinaryAsync(FetchRequest request, IReadOnlySet<string> hosts, CancellationToken cancellationToken)
    {
        var method = request.Method.ToUpperInvariant();
        if (method is not ("GET" or "HEAD" or "POST")) throw new ArgumentException("Only GET, HEAD and POST are supported.");
        var headers = request.Headers ?? [];
        ProviderResults.ValidateHeaders(JsonSerializer.SerializeToElement(headers));
        var uri = new Uri(request.Url, UriKind.Absolute);
        var body = request.Body;
        for (var redirect = 0; redirect <= 5; redirect++)
        {
            ValidateDestination(uri, hosts);
            using var message = new HttpRequestMessage(new HttpMethod(method), uri);
            if (body is not null) message.Content = new StringContent(body, Encoding.UTF8);
            foreach (var (name, value) in headers)
            {
                if (name.Equals("Host", StringComparison.OrdinalIgnoreCase) || name.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) ||
                    name.Equals("Connection", StringComparison.OrdinalIgnoreCase) || name.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase) ||
                    name.Equals("Proxy-Authorization", StringComparison.OrdinalIgnoreCase))
                    throw new ArgumentException($"Header {name} is host controlled.");
                if (name.StartsWith("Content-", StringComparison.OrdinalIgnoreCase))
                {
                    message.Content ??= new ByteArrayContent([]);
                    message.Content.Headers.Remove(name);
                    if (!message.Content.Headers.TryAddWithoutValidation(name, value)) throw new ArgumentException("Invalid content header.");
                }
                else if (!message.Headers.TryAddWithoutValidation(name, value)) throw new ArgumentException("Invalid request header.");
            }
            using var response = await client.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if ((int)response.StatusCode is 301 or 302 or 303 or 307 or 308 && response.Headers.Location is { } location)
            {
                var next = new Uri(uri, location);
                if (next.Host != uri.Host || next.Port != uri.Port)
                    headers = headers.Where(h => !h.Key.Equals("Authorization", StringComparison.OrdinalIgnoreCase) && !h.Key.Equals("Cookie", StringComparison.OrdinalIgnoreCase)).ToDictionary();
                if ((int)response.StatusCode == 303 || (int)response.StatusCode is 301 or 302 && method == "POST")
                { method = "GET"; body = null; headers = headers.Where(h => !h.Key.StartsWith("Content-", StringComparison.OrdinalIgnoreCase)).ToDictionary(); }
                uri = next;
                continue;
            }
            const int maxBytes = 2 * 1024 * 1024;
            if (response.Content.Headers.ContentLength > maxBytes) throw new InvalidOperationException("Response exceeds 2 MiB.");
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            using var data = new MemoryStream();
            var buffer = new byte[8192];
            int count;
            while ((count = await stream.ReadAsync(buffer, cancellationToken)) > 0)
            {
                if (data.Length + count > maxBytes) throw new InvalidOperationException("Response exceeds 2 MiB.");
                data.Write(buffer, 0, count);
            }
            var responseHeaders = response.Headers.Concat(response.Content.Headers)
                .ToDictionary(h => h.Key, h => string.Join(", ", h.Value), StringComparer.OrdinalIgnoreCase);
            return new BinaryFetchResponse((int)response.StatusCode, uri.AbsoluteUri, responseHeaders, data.ToArray(), $"{(int)response.StatusCode} {response.ReasonPhrase}".TrimEnd());
        }
        throw new InvalidOperationException("Too many redirects.");
    }

    public static void ValidateDestination(Uri uri, IReadOnlySet<string> hosts)
    {
        if (uri.Scheme != "https" || uri.Port != 443 || !string.IsNullOrEmpty(uri.UserInfo) ||
            uri.HostNameType != UriHostNameType.Dns || !hosts.Contains(uri.IdnHost))
            throw new InvalidOperationException($"Destination is outside the provider's HTTPS host grants: {uri.Scheme}://{uri.IdnHost}:{uri.Port}");
    }

    // Conservative public-unicast policy. DNS is resolved at connection time and
    // the socket connects directly to the checked IP, avoiding DNS rebinding.
    public static bool IsPublicAddress(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) return IsPublicAddress(address.MapToIPv4());
        var b = address.GetAddressBytes();
        if (address.AddressFamily == AddressFamily.InterNetworkV6)
            return (b[0] & 0xe0) == 0x20 && !(b[0] == 0x20 && b[1] == 0x01 && b[2] < 2) &&
                !(b[0] == 0x20 && b[1] == 0x01 && b[2] == 0x0d && b[3] == 0xb8) &&
                !(b[0] == 0x20 && b[1] == 0x02);
        if (address.AddressFamily != AddressFamily.InterNetwork) return false;
        return b[0] is not (0 or 10 or 127) && b[0] < 224 &&
            !(b[0] == 100 && b[1] is >= 64 and <= 127) &&
            !(b[0] == 169 && b[1] == 254) && !(b[0] == 172 && b[1] is >= 16 and <= 31) &&
            !(b[0] == 192 && (b[1] == 168 || b[1] == 0 || b[1] == 2)) &&
            !(b[0] == 198 && (b[1] is 18 or 19 || b[1] == 51 && b[2] == 100)) &&
            !(b[0] == 203 && b[1] == 0 && b[2] == 113);
    }

    private static async ValueTask<Stream> ConnectPublicAsync(SocketsHttpConnectionContext context, CancellationToken ct)
    {
        var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, ct);
        foreach (var address in addresses.Where(IsPublicAddress))
        {
            var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
            try { await socket.ConnectAsync(address, context.DnsEndPoint.Port, ct); return new NetworkStream(socket, ownsSocket: true); }
            catch (SocketException) { socket.Dispose(); }
            catch { socket.Dispose(); throw; }
        }
        throw new HttpRequestException("No reachable public address for provider host.");
    }

    public void Dispose() => client.Dispose();
}
