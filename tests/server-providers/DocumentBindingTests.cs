using System.Text.Json;

namespace Vestra.Providers.Tests;

public sealed class DocumentBindingTests
{
    private const string Skeleton = """
        class Provider {
          getSettings() { BODY }
          search(opts) { return []; }
          findEpisodes(id) { return []; }
          findEpisodeServer(ep, server) { throw new Error('not needed'); }
        }
        """;

    [Fact]
    public async Task SelectorsTraversalCallbacksAndMissingAttributesMatchSupportedContract()
    {
        var result = await Settings("""
          const $=LoadDoc('<ul><li data-id="a"><a href="/a">A &amp; B</a></li><li class="dub"><a>B</a></li></ul>');
          const items=$('li'); const seen=[];
          items.each((i,el)=>seen.push(i+':'+el.find('a').text()));
          return { supportsDub:false, episodeServers:[
            String(items.length()),items.first().data('id'),items.last().text(),
            String(items.eq(-3).length()),String(items.eq(9).length()),
            String(items.filter('.dub').length()),String(items.not('.dub').length()),
            String(items.first().is('.dub')),String(items.has('a[href]').length()),
            items.first().parent().children('.dub').text(),items.first().find('a').attr('missing') === undefined ? 'absent':'wrong',
            items.map((i,el)=>el.text()).join('|'),seen.join('|'),items.first().find('a').attrs().href
          ]};
          """);
        Assert.Equal(new[] {"2","a","B","0","0","1","1","false","1","B","absent","A & B|B","0:A & B|1:B","/a"}, result);
    }

    [Fact]
    public async Task HtmlParserDoesNotExecuteScriptsOrFetchResources()
    {
        var result = await Settings("""
          globalThis.ran=false;
          const d=new Doc('<script>globalThis.ran=true; fetch("https://unexpected.example")</script><img src="https://unexpected.example/a"><b>Text</b>');
          return {supportsDub:false,episodeServers:[String(globalThis.ran),d.find('b').html()]};
          """);
        Assert.Equal(new[] {"false","Text"}, result);
    }

    [Fact]
    public async Task Base64SupportsBinaryRoundTripWhitespaceAndUnpaddedInput()
    {
        Assert.Equal(new[] {"hello","aGVsbG8=","255"}, await Settings("return {supportsDub:false,episodeServers:[atob('aGVs bG8'),btoa('hello'),String(atob(btoa(String.fromCharCode(255))).charCodeAt(0))]};"));
        await Assert.ThrowsAnyAsync<Exception>(()=>Settings("return {supportsDub:false,episodeServers:[btoa('漢')]};"));
    }

    [Theory]
    [InlineData("const d=new Doc('<b>x</b>'); d.find('[');")]
    [InlineData("for(let i=0;i<17;i++) new Doc('<b>x</b>');")]
    public async Task InvalidSelectorsAndDocumentBudgetFailPredictably(string body) =>
        await Assert.ThrowsAnyAsync<Exception>(()=>Settings(body+"return {supportsDub:false,episodeServers:[]};"));

    [Fact]
    public async Task SuppliedDomProviderRunsSearchEpisodesAndStreamOffline()
    {
        var path=Environment.GetEnvironmentVariable("VESTRA_TEST_SEANIME_DOM_PROVIDER");
        if(path is null)return;
        var transport=new HtmlTransport();
        var runtime=new ProviderRuntime(transport);
        await runtime.LoadAsync(new("saturn-fixture",await File.ReadAllTextAsync(path),["animesaturn.ro","embed.example"]));
        var search=await runtime.CallAsync("saturn-fixture","search",[JsonSerializer.SerializeToElement(new {query="Fixture",dub=false})]);
        Assert.Equal("Fixture",search[0].GetProperty("title").GetString());
        var eps=await runtime.CallAsync("saturn-fixture","findEpisodes",[search[0].GetProperty("id")]);
        var stream=await runtime.CallAsync("saturn-fixture","findEpisodeServer",[eps[0],JsonSerializer.SerializeToElement("Server 1")]);
        Assert.Equal("https://cdn.example/video.m3u8",stream.GetProperty("videoSources")[0].GetProperty("url").GetString());
        Assert.Equal("https://embed.example/player",stream.GetProperty("headers").GetProperty("Referer").GetString());
        Assert.Equal(4,transport.Calls);
    }

    private static async Task<string[]> Settings(string body)
    {
        var runtime=new ProviderRuntime(new NoNetwork());
        await runtime.LoadAsync(new("dom-test",Skeleton.Replace("BODY",body),[]));
        return (await runtime.CallAsync("dom-test","getSettings",[])).GetProperty("episodeServers").Deserialize<string[]>()!;
    }
    private sealed class NoNetwork:IProviderTransport
    {
        public Task<FetchResponse> FetchAsync(FetchRequest r,IReadOnlySet<string> h,CancellationToken ct)=>throw new InvalidOperationException("Unexpected network access.");
    }
    private sealed class HtmlTransport:IProviderTransport
    {
        public int Calls {get;private set;}
        public Task<FetchResponse> FetchAsync(FetchRequest request,IReadOnlySet<string> hosts,CancellationToken ct)
        {
            ProviderHttpTransport.ValidateDestination(new Uri(request.Url),hosts);Calls++;
            var body=new Uri(request.Url).AbsolutePath switch {
                "/"=>"<article class='bs'><a href='https://animesaturn.ro/fixture/' title='Fixture Sub ITA'><span class='tt'>Fixture</span><span class='sb'>sub</span></a></article>",
                "/fixture/"=>"<div class='eplister'><ul><li><a href='https://animesaturn.ro/fixture-1/'><span class='epl-num'>1</span></a></li></ul></div>",
                "/fixture-1/"=>"<div id='pembed'><iframe src='https://embed.example/player'></iframe></div>",
                "/player"=>"file: \"https://cdn.example/video.m3u8\"",
                _=>throw new InvalidOperationException("Unexpected fixture request.")};
            return Task.FromResult(new FetchResponse(200,request.Url,[],body));
        }
    }
}
