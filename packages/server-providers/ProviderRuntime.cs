using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using Jint;

namespace Vestra.Providers;

public sealed record ProviderDefinition(string Id, string Source, string[] Hosts,
    Dictionary<string, JsonElement>? Preferences = null, string Type = "onlinestream-provider");

public sealed record FetchRequest(string Url, string Method = "GET",
    Dictionary<string, string>? Headers = null, string? Body = null);

public sealed record FetchResponse(int Status, string Url,
    Dictionary<string, string> Headers, string Body, string StatusText = "");

public interface IProviderTransport
{
    Task<FetchResponse> FetchAsync(FetchRequest request, IReadOnlySet<string> hosts,
        CancellationToken cancellationToken);
}

public sealed record ProviderLimits(int TimeoutMs = 10_000, int MaxStatements = 1_000_000,
    long MemoryBytes = 64 * 1024 * 1024, int MaxFetches = 32);

/// <summary>
/// Initial Seanime online-stream provider contract. Each call gets its own engine
/// and Provider instance; engines and CLR objects never cross the JSON boundary.
/// Run this in the sidecar worker, not the UI process. Jint is not an OS sandbox.
/// </summary>
public sealed class ProviderRuntime(IProviderTransport transport, ProviderLimits? limits = null, ProviderStore? store = null)
{
    private readonly ConcurrentDictionary<string, ProviderDefinition> providers = new();
    private readonly SemaphoreSlim lane = new(1);
    private readonly ProviderLimits limits = limits ?? new();
    private readonly ProviderStore store = store ?? new();
    public string[] List() => providers.Keys.Order().ToArray();

    public async Task<string[]> LoadAsync(ProviderDefinition definition, CancellationToken ct = default)
    {
        var requiredMethods = MethodsFor(definition.Type);
        if (string.IsNullOrWhiteSpace(definition.Id) || definition.Id.Length > 120 ||
            definition.Id.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not '-' and not '_' and not '.'))
            throw new ArgumentException("Invalid provider ID.");
        if (string.IsNullOrWhiteSpace(definition.Source) || Encoding.UTF8.GetByteCount(definition.Source) > 1_048_576)
            throw new ArgumentException("Provider source must be non-empty JavaScript, at most 1 MiB.");
        if (definition.Hosts is null || definition.Hosts.Length > 32 || definition.Hosts.Any(h =>
                string.IsNullOrWhiteSpace(h) || h.Length > 253 ||
                Uri.CheckHostName(h) != UriHostNameType.Dns || h.Contains('*')))
            throw new ArgumentException("Hosts must be explicit DNS names (at most 32); wildcards are unsupported.");
        if (providers.Count >= 32 && !providers.ContainsKey(definition.Id))
            throw new InvalidOperationException("At most 32 providers can be loaded.");
        var copy = definition with
        {
            Hosts = definition.Hosts.Select(h => h.ToLowerInvariant()).Distinct().ToArray(),
            Preferences = definition.Preferences?.ToDictionary(p => p.Key, p => p.Value.Clone())
        };
        var result = await ExecuteAsync(copy, null, [], ct);
        var methods = result.Deserialize<string[]>()!;
        foreach (var required in requiredMethods)
            if (!methods.Contains(required)) throw new ArgumentException($"Provider is missing {required}().");
        providers[copy.Id] = copy;
        return methods;
    }

    public bool Unload(string id) => providers.TryRemove(id, out _);

    public async Task<JsonElement> CallAsync(string id, string method, JsonElement[] args,
        CancellationToken ct = default)
    {
        if (!providers.TryGetValue(id, out var definition)) throw new KeyNotFoundException("Provider is not loaded.");
        if (!MethodsFor(definition.Type).Contains(method)) throw new ArgumentException("Unsupported method for this provider type.");
        ValidateArguments(method, args);
        var result = await ExecuteAsync(definition, method, args, ct);
        return definition.Type == "manga-provider" ? MangaResults.Validate(id, method, result) : ProviderResults.Validate(id, method, result);
    }

    private static string[] MethodsFor(string type) => type switch
    {
        "onlinestream-provider" => ["search", "findEpisodes", "findEpisodeServer", "getSettings"],
        "manga-provider" => ["search", "findChapters", "findChapterPages", "getSettings"],
        _ => throw new ArgumentException("Unsupported provider type.")
    };

    private static void ValidateArguments(string method, JsonElement[] args)
    {
        var expected = method switch { "getSettings" => 0, "findEpisodeServer" => 2, _ => 1 };
        if (args.Length != expected) throw new ArgumentException($"{method} expects {expected} arguments.");
        if (method == "search" && (args[0].ValueKind != JsonValueKind.Object ||
            !args[0].TryGetProperty("query", out var q) || q.ValueKind != JsonValueKind.String))
            throw new ArgumentException("search expects an options object with query.");
        if (method is "findEpisodes" or "findChapters" or "findChapterPages" && args[0].ValueKind != JsonValueKind.String)
            throw new ArgumentException($"{method} expects an ID string.");
        if (method == "findEpisodeServer" && (args[0].ValueKind != JsonValueKind.Object || args[1].ValueKind != JsonValueKind.String))
            throw new ArgumentException("findEpisodeServer expects an episode object and server string.");
    }

    private async Task<JsonElement> ExecuteAsync(ProviderDefinition definition, string? method,
        JsonElement[] args, CancellationToken ct)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(limits.TimeoutMs);
        await lane.WaitAsync(deadline.Token);
        try
        {
            // The current transport callback is synchronous inside JS. Keep it off
            // the HTTP/UI thread; its IO has the same cancellation/deadline token.
            return await Task.Run(() => Execute(definition, method, args, deadline.Token), deadline.Token);
        }
        finally { lane.Release(); }
    }

    private JsonElement Execute(ProviderDefinition definition, string? method,
        JsonElement[] args, CancellationToken ct)
    {
        using var engine = new Engine(options => options
            .LimitMemory(limits.MemoryBytes)
            .MaxStatements(limits.MaxStatements)
            .LimitRecursion(128)
            .TimeoutInterval(TimeSpan.FromMilliseconds(limits.TimeoutMs))
            .CancellationToken(ct));
        var fetches = 0;
        using var dom = new DocumentBinding(ct);
        dom.Bind(engine);
        engine.SetValue("__base64Decode", new Func<string, string>(s =>
        {
            if (s.Length > 2_097_152) throw new ArgumentException("Base64 input too large.");
            var value = string.Concat(s.Where(c => !char.IsWhiteSpace(c)));
            if (value.Length % 4 == 1) throw new ArgumentException("Invalid base64.");
            return Encoding.Latin1.GetString(Convert.FromBase64String(value.PadRight((value.Length + 3) / 4 * 4, '=')));
        }));
        engine.SetValue("__base64Encode", new Func<string, string>(s =>
        {
            if (s.Length > 2_097_152 || s.Any(c => c > 255)) throw new ArgumentException("btoa requires a bounded binary string.");
            return Convert.ToBase64String(Encoding.Latin1.GetBytes(s));
        }));
        var hosts = definition.Hosts.ToHashSet(StringComparer.OrdinalIgnoreCase);
        engine.SetValue("__hostFetch", new Func<string, string>(requestJson =>
        {
            ct.ThrowIfCancellationRequested();
            if (++fetches > limits.MaxFetches) throw new InvalidOperationException("Provider fetch budget exceeded.");
            if (Encoding.UTF8.GetByteCount(requestJson) > 65_536) throw new ArgumentException("Fetch request too large.");
            var request = JsonSerializer.Deserialize<FetchRequest>(requestJson, JsonOptions)!;
            var response = transport.FetchAsync(request, hosts, ct).GetAwaiter().GetResult();
            return JsonSerializer.Serialize(response, JsonOptions);
        }));
        engine.SetValue("__preferenceJson", JsonSerializer.Serialize(definition.Preferences ?? [], JsonOptions));
        engine.SetValue("__argsJson", JsonSerializer.Serialize(args));
        engine.SetValue("__method", method ?? "");
        engine.SetValue("__methodsJson", JsonSerializer.Serialize(MethodsFor(definition.Type)));
        engine.Execute(Bootstrap);
        FormBindings.Bind(engine);
        BinaryUrlBindings.Bind(engine);
        CryptoBindings.Bind(engine);
        store.Bind(engine, definition.Id);
        engine.Execute(definition.Source);
        var value = method is null
            ? engine.Evaluate("JSON.stringify(JSON.parse(__methodsJson).filter(k => typeof Provider.prototype[k] === 'function'))")
            : engine.Evaluate("(async () => JSON.stringify(await new Provider()[__method](...JSON.parse(__argsJson))))()").UnwrapIfPromise(ct);
        if (!value.IsString()) throw new InvalidOperationException("Provider returned no JSON result.");
        var json = value.AsString();
        if (Encoding.UTF8.GetByteCount(json) > 2_097_152) throw new InvalidOperationException("Provider result exceeds 2 MiB.");
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private const string Bootstrap = """
        const __preferences = JSON.parse(__preferenceJson);
        function atob(s) { return __base64Decode(String(s)); }
        function btoa(s) { return __base64Encode(String(s)); }
        function $getUserPreference(key) { return __preferences[key]; }
        const console = Object.freeze({ log() {}, info() {}, warn() {}, error() {}, debug() {} });
        async function fetch(url, init = {}) {
          const requestHeaders=new Headers(init.headers);
          let body=init.body??null;
          if(body instanceof FormData){const encoded=body._encode();body=encoded.body;requestHeaders.set('Content-Type',encoded.contentType);}
          else if(body instanceof URLSearchParams){body=body.toString();if(!requestHeaders.has('Content-Type'))requestHeaders.set('Content-Type','application/x-www-form-urlencoded;charset=UTF-8');}
          else if(body!==null && typeof body==='object'){body=JSON.stringify(body);if(!requestHeaders.has('Content-Type'))requestHeaders.set('Content-Type','application/json');}
          else if(body!==null)body=String(body);
          const r = JSON.parse(__hostFetch(JSON.stringify({
            url: String(url), method: init.method || 'GET', headers: Object.fromEntries(requestHeaders), body
          })));
          const headers = Object.freeze({ ...r.headers, get(name) {
            const k = Object.keys(r.headers).find(k => k.toLowerCase() === String(name).toLowerCase());
            return k === undefined ? null : r.headers[k];
          }});
          return Object.freeze({ status: r.status, statusText:r.statusText||String(r.status),ok: r.status >= 200 && r.status < 300,
            url: r.url, headers, text: () => r.body, json: () => {try{return JSON.parse(r.body);}catch{return null;}} });
        }
        """;
}
