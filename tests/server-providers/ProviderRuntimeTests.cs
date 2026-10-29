using System.Net;
using System.Text.Json;
using Vestra.Providers;

namespace Vestra.Providers.Tests;

public sealed class ProviderRuntimeTests
{
    private const string Source = """
        class Provider {
          getSettings() { return { episodeServers: ['SUB'], supportsDub: false }; }
          async search(opts) {
            const res = await fetch('https://fixture.example/search?q=' + encodeURIComponent(opts.query));
            if (!res.ok) throw new Error('search failed');
            return await res.json();
          }
          async findEpisodes(id) {
            return [{id: id + '-1', number: 1, url: 'https://fixture.example/episode/1', provider: 'forged'}];
          }
          async findEpisodeServer(episode, server) {
            const res = await fetch(episode.url, { headers: { 'X-Test': $getUserPreference('key') } });
            const body = await res.text();
            return { provider: 'forged', server, headers: { Referer: 'https://fixture.example/' },
              videoSources: [{ url: JSON.parse(body).stream, type: 'm3u8', quality: 'auto',
                subtitles: [{id:'en', url:'https://cdn.example/sub.vtt', language:'en', isDefault:true}] }] };
          }
        }
        """;

    [Fact]
    public async Task SearchEpisodesAndStreamPreservePlayerInputsAndHostIdentity()
    {
        var transport = new FixtureTransport();
        var runtime = new ProviderRuntime(transport);
        var methods = await runtime.LoadAsync(new("fixture", Source, ["fixture.example"], new() { ["key"] = Json("\"test-key\"") }));
        Assert.Equal(4, methods.Length);
        var settings = await runtime.CallAsync("fixture", "getSettings", []);
        Assert.Equal("SUB", settings.GetProperty("episodeServers")[0].GetString());
        var search = await runtime.CallAsync("fixture", "search", [Json("{\"query\":\"Test anime\"}")]);
        Assert.Single(search.EnumerateArray());
        var episodes = await runtime.CallAsync("fixture", "findEpisodes", [search[0].GetProperty("id")]);
        Assert.Equal("fixture", episodes[0].GetProperty("provider").GetString());
        var stream = await runtime.CallAsync("fixture", "findEpisodeServer", [episodes[0], Json("\"SUB\"")]);
        Assert.Equal("fixture", stream.GetProperty("provider").GetString());
        Assert.Equal("https://cdn.example/video.m3u8", stream.GetProperty("videoSources")[0].GetProperty("url").GetString());
        Assert.Equal("en", stream.GetProperty("videoSources")[0].GetProperty("subtitles")[0].GetProperty("language").GetString());
        Assert.Equal("https://fixture.example/", stream.GetProperty("headers").GetProperty("Referer").GetString());
        Assert.Equal("test-key", transport.Requests[1].Headers!["x-test"]);
        Assert.Contains("Test%20anime", transport.Requests[0].Url);
        Assert.True(runtime.Unload("fixture"));
        await Assert.ThrowsAsync<KeyNotFoundException>(() => runtime.CallAsync("fixture", "getSettings", []));
    }

    [Fact]
    public async Task DoesNotLoadIncompleteProviderOrReplaceWorkingProviderOnFailure()
    {
        var runtime = new ProviderRuntime(new FixtureTransport());
        await runtime.LoadAsync(new("fixture", Source, []));
        await Assert.ThrowsAsync<ArgumentException>(() => runtime.LoadAsync(new("fixture", "class Provider {}", [])));
        Assert.Equal("SUB", (await runtime.CallAsync("fixture", "getSettings", [])).GetProperty("episodeServers")[0].GetString());
    }

    [Fact]
    public async Task RejectedPromiseIsAnErrorAndNextCallWorks()
    {
        var runtime = new ProviderRuntime(new FixtureTransport());
        await runtime.LoadAsync(new("fixture", Source.Replace("if (!res.ok)", "if (true)"), ["fixture.example"]));
        var error = await Assert.ThrowsAnyAsync<Exception>(() => runtime.CallAsync("fixture", "search", [Json("{\"query\":\"x\"}")]));
        Assert.Contains("search failed", error.Message);
        Assert.Equal(JsonValueKind.Object, (await runtime.CallAsync("fixture", "getSettings", [])).ValueKind);
    }

    [Theory]
    [InlineData("while (true) {}")]
    [InlineData("return await new Promise(() => {});")]
    public async Task LimitsInterruptLoopsAndUnsettledPromises(string body)
    {
        var runtime = new ProviderRuntime(new FixtureTransport(), new ProviderLimits(TimeoutMs: 150, MaxStatements: 10_000));
        await runtime.LoadAsync(new("fixture", Source.Replace("const res = await fetch('https://fixture.example/search?q=' + encodeURIComponent(opts.query));", body), []));
        await Assert.ThrowsAnyAsync<Exception>(() => runtime.CallAsync("fixture", "search", [Json("{\"query\":\"x\"}")]).WaitAsync(TimeSpan.FromSeconds(3)));
        Assert.Equal(JsonValueKind.Object, (await runtime.CallAsync("fixture", "getSettings", [])).ValueKind);
    }

    [Fact]
    public async Task NetworkCancellationReachesTransport()
    {
        var transport = new WaitingTransport();
        var runtime = new ProviderRuntime(transport);
        await runtime.LoadAsync(new("fixture", Source, ["fixture.example"]));
        using var cts = new CancellationTokenSource();
        var pending = runtime.CallAsync("fixture", "search", [Json("{\"query\":\"x\"}")], cts.Token);
        await transport.Entered.Task.WaitAsync(TimeSpan.FromSeconds(3));
        cts.Cancel();
        await Assert.ThrowsAnyAsync<Exception>(() => pending.WaitAsync(TimeSpan.FromSeconds(3)));
        Assert.True(transport.Cancelled);
    }

    [Fact]
    public async Task RejectsMalformedStreamAndInvalidArguments()
    {
        var runtime = new ProviderRuntime(new FixtureTransport());
        await runtime.LoadAsync(new("fixture", Source.Replace("JSON.parse(body).stream", "'javascript:alert(1)'"), ["fixture.example"]));
        await Assert.ThrowsAsync<InvalidOperationException>(() => runtime.CallAsync("fixture", "findEpisodeServer", [Json("{\"url\":\"https://fixture.example/episode/1\"}"), Json("\"SUB\"")]));
        await Assert.ThrowsAsync<ArgumentException>(() => runtime.CallAsync("fixture", "findEpisodes", []));
        await Assert.ThrowsAsync<ArgumentException>(() => runtime.CallAsync("fixture", "constructor", []));
    }

    [Fact]
    public async Task DoesNotExposeClrAndBudgetsFetches()
    {
        var runtime = new ProviderRuntime(new FixtureTransport(), new ProviderLimits(MaxFetches: 1));
        var source = Source.Replace("const res = await fetch('https://fixture.example/search?q=' + encodeURIComponent(opts.query));", "if (typeof System !== 'undefined' || typeof importNamespace !== 'undefined') throw new Error('CLR exposed'); await fetch('https://fixture.example/first'); const res = await fetch('https://fixture.example/second');");
        await runtime.LoadAsync(new("fixture", source, ["fixture.example"]));
        var error = await Assert.ThrowsAnyAsync<Exception>(() => runtime.CallAsync("fixture", "search", [Json("{\"query\":\"x\"}")]));
        Assert.Contains("fetch budget", error.Message);
    }

    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("10.0.0.1")]
    [InlineData("169.254.169.254")]
    [InlineData("100.64.0.1")]
    [InlineData("::1")]
    [InlineData("::ffff:127.0.0.1")]
    [InlineData("fc00::1")]
    [InlineData("2001:db8::1")]
    public void RejectsNonPublicAddresses(string address) => Assert.False(ProviderHttpTransport.IsPublicAddress(IPAddress.Parse(address)));

    [Theory]
    [InlineData("http://fixture.example/")]
    [InlineData("https://fixture.example:444/")]
    [InlineData("https://other.example/")]
    [InlineData("https://fixture.example.evil.example/")]
    [InlineData("https://user:password@fixture.example/")]
    [InlineData("https://127.0.0.1/")]
    public void RejectsUrlsOutsideExactGrant(string url) => Assert.Throws<InvalidOperationException>(() =>
        ProviderHttpTransport.ValidateDestination(new Uri(url), new HashSet<string> { "fixture.example" }));

    // Optional external-artifact corroboration; the upstream script is not vendored.
    // The default suite above remains self-contained when this path is absent.
    [Fact]
    public async Task SuppliedSeanimeArtifactRunsAgainstOfflineResponses()
    {
        var path = Environment.GetEnvironmentVariable("VESTRA_TEST_SEANIME_PROVIDER");
        if (path is null) return;
        var source = await File.ReadAllTextAsync(path);
        var transport = new SeanimeArtifactTransport();
        var runtime = new ProviderRuntime(transport);
        await runtime.LoadAsync(new("artifact", source, ["anidb.app", "embed.example"]));
        var search = await runtime.CallAsync("artifact", "search", [Json("{\"query\":\"Fixture\"}")]);
        var episodes = await runtime.CallAsync("artifact", "findEpisodes", [search[0].GetProperty("id")]);
        var stream = await runtime.CallAsync("artifact", "findEpisodeServer", [episodes[0], Json("\"SUB\"")]);
        Assert.Equal("https://cdn.example/video.m3u8", stream.GetProperty("videoSources")[0].GetProperty("url").GetString());
        Assert.Equal(4, transport.Calls);
    }

    private static JsonElement Json(string json) => JsonSerializer.Deserialize<JsonElement>(json);

    private sealed class FixtureTransport : IProviderTransport
    {
        public List<FetchRequest> Requests { get; } = [];
        public Task<FetchResponse> FetchAsync(FetchRequest request, IReadOnlySet<string> hosts, CancellationToken ct)
        {
            ProviderHttpTransport.ValidateDestination(new Uri(request.Url), hosts);
            Requests.Add(request);
            return Task.FromResult(new FetchResponse(200, request.Url, [], request.Url.Contains("/search?")
                ? "[{\"id\":\"anime\",\"title\":\"Fixture\",\"url\":\"https://fixture.example/anime\",\"subOrDub\":\"sub\"}]"
                : "{\"stream\":\"https://cdn.example/video.m3u8\"}"));
        }
    }

    private sealed class WaitingTransport : IProviderTransport
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool Cancelled { get; private set; }
        public async Task<FetchResponse> FetchAsync(FetchRequest request, IReadOnlySet<string> hosts, CancellationToken ct)
        {
            Entered.SetResult();
            try { await Task.Delay(Timeout.Infinite, ct); }
            catch (OperationCanceledException) { Cancelled = true; throw; }
            throw new InvalidOperationException();
        }
    }

    private sealed class SeanimeArtifactTransport : IProviderTransport
    {
        public int Calls { get; private set; }
        public Task<FetchResponse> FetchAsync(FetchRequest request, IReadOnlySet<string> hosts, CancellationToken ct)
        {
            ProviderHttpTransport.ValidateDestination(new Uri(request.Url), hosts);
            Calls++;
            var body = new Uri(request.Url).AbsolutePath switch
            {
                "/browse" => "<a href=\"https://anidb.app/anime/fixture-123\" class=\"anime-card block group\" title=\"Fixture\">",
                "/api/frontend/anime/123/episodes" => "{\"episodes\":[{\"id\":42}]}",
                "/api/frontend/episode/42/languages" => "{\"languages\":[{\"code\":\"jpn\",\"embed_url\":\"https://embed.example/player\"}]}",
                "/player" => "sources: [{file: 'https://cdn.example/video.m3u8'}]",
                _ => throw new InvalidOperationException("Unexpected artifact request.")
            };
            return Task.FromResult(new FetchResponse(200, request.Url, [], body));
        }
    }
}
