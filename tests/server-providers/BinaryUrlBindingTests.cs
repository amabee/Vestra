using System.Text;
using System.Text.Json;

namespace Vestra.Providers.Tests;

public sealed class BinaryUrlBindingTests
{
    [Fact]
    public async Task BufferPreservesUtf8BinaryAndTypedArrayInputs()
    {
        Assert.Equal(new[]{"héllo 世界","68c3a96c6c6f20e4b896e7958c","true","00ff02","bc","3","fffd"}, await Run("""
          const b=Buffer.from('héllo 世界');
          return [Buffer.from(b.toString('base64'),'base64').toString('utf-8'),b.toString('hex'),
            String(Buffer.isBuffer(b)),Buffer.from(new Uint8Array([0,255,2])).toString('hex'),
            Buffer.from('abcd').toString('utf8',1,3),String(Buffer.byteLength('世')),
            Buffer.from([255]).toString('utf8').charCodeAt(0).toString(16)];
          """));
    }

    [Fact]
    public async Task BufferCopiesAndSupportsUrlSafeBase64()
    {
        Assert.Equal(new[]{"255","0","-__v","fbffef"}, await Run("""
          const a=Buffer.from([255]); const b=Buffer.from(a);a[0]=0;
          return [String(b[0]),String(Buffer.alloc(2)[0]),Buffer.from('fbffef','hex').toString('base64url'),Buffer.from('-__v','base64url').toString('hex')];
          """));
    }

    [Theory]
    [InlineData("Buffer.alloc(1048577)")]
    [InlineData("Buffer.from(20)")]
    [InlineData("Buffer.from('x','unsupported')")]
    [InlineData("Buffer.from('zz','hex')")]
    [InlineData("Buffer.from('@@@@','base64')")]
    public async Task InvalidBufferInputsAreRejected(string expression) =>
        await Assert.ThrowsAnyAsync<Exception>(()=>Run($"{expression}; return [];"));

    [Fact]
    public async Task QueryParametersPreserveOrderDuplicatesAndFormEncoding()
    {
        Assert.Equal(new[]{"1|2","a=first&space=a+b&symbols=%7E%21*&unicode=%E4%B8%96","first","4","%ZZ �"},await Run("""
          const q=new URLSearchParams('?a=1&a=2&space=a+b');const values=q.getAll('a').join('|');
          q.set('a','first');q.append('unicode','世');q.append('symbols','~!*');q.sort();
          return [values,q.toString(),new URLSearchParams(q).get('a'),String(q.size),new URLSearchParams('x=%ZZ+%FF').get('x')];
          """));
    }

    [Fact]
    public async Task QueryRecordsSequencesDeletionAndIterationWork()
    {
        Assert.Equal(new[]{"a=2&b=3","a:2|b:3","false","a,b"},await Run("""
          const q=new URLSearchParams([['a','1'],['a','2'],['b','3']]);q.delete('a','1');const out=[];
          q.forEach((value,key)=>out.push(key+':'+value));
          return [q.toString(),out.join('|'),String(q.has('a','1')),[...q.keys()].join(',')];
          """));
    }

    [Fact]
    public async Task UrlResolvesRelativePathsAndKeepsQueryObjectLive()
    {
        Assert.Equal(new[]{"https://example.com/b?token=a+b#part","/b","a b","https://example.com","https://example.com/b?token=new+value#part","x=1","yes"},await Run("""
          const u=new URL('../b?token=a+b#part','https://EXAMPLE.com:443/a/');const initial=u.href;
          const params=u.searchParams;params.set('token','new value');const changed=u.href;
          u.search='x=1';params.append('live','yes');
          return [initial,u.pathname,'a b',u.origin,changed,'x='+u.searchParams.get('x'),u.searchParams.get('live')];
          """));
    }

    [Theory]
    [InlineData("new URL('file:///etc/passwd')")]
    [InlineData("new URL('/relative')")]
    [InlineData("new URL('https://user:secret@example.com')")]
    public async Task UrlRejectsUnsupportedForms(string expression)=>
        await Assert.ThrowsAnyAsync<Exception>(()=>Run($"{expression}; return [];"));

    [Fact]
    public async Task SuppliedBufferProviderResolvesOfflineEmbed()
    {
        var path=Environment.GetEnvironmentVariable("VESTRA_TEST_SEANIME_BUFFER_PROVIDER");
        if(path is null)return;
        var transport=new BufferTransport();var runtime=new ProviderRuntime(transport);
        await runtime.LoadAsync(new("donghua",await File.ReadAllTextAsync(path),["donghuastream.org","geo.dailymotion.com"]));
        var search=await runtime.CallAsync("donghua","search",[JsonSerializer.SerializeToElement(new {query="Fixture"})]);
        var eps=await runtime.CallAsync("donghua","findEpisodes",[search[0].GetProperty("id")]);
        var stream=await runtime.CallAsync("donghua","findEpisodeServer",[eps[0],JsonSerializer.SerializeToElement("Server 1")]);
        Assert.Equal("https://cdn.example/video.m3u8",stream.GetProperty("videoSources")[0].GetProperty("url").GetString());
        Assert.Equal(4,transport.Calls);
    }

    private static async Task<string[]> Run(string body)
    {
        var source="class Provider { getSettings(){ const run=()=>{ "+body+" };return {episodeServers:run(),supportsDub:false}; } search(){return [];} findEpisodes(){return [];} findEpisodeServer(){throw new Error('unused');} }";
        var runtime=new ProviderRuntime(new BufferTransport());await runtime.LoadAsync(new("bindings",source,[]));
        return (await runtime.CallAsync("bindings","getSettings",[])).GetProperty("episodeServers").Deserialize<string[]>()!;
    }
    private sealed class BufferTransport:IProviderTransport
    {
        public int Calls {get;private set;}
        public Task<FetchResponse> FetchAsync(FetchRequest r,IReadOnlySet<string> h,CancellationToken ct)
        {
            ProviderHttpTransport.ValidateDestination(new Uri(r.Url),h);Calls++;
            var embed=Convert.ToBase64String(Encoding.UTF8.GetBytes("<iframe src=\"https://geo.dailymotion.com/player\"></iframe>"));
            var body=new Uri(r.Url).AbsolutePath switch {
                "/"=>"<a href=\"https://donghuastream.org/anime/fixture/\" itemprop=\"url\" title=\"Fixture\">",
                "/anime/fixture/"=>"<a href=\"https://donghuastream.org/ep/1\"><div class=\"epl-num\">1</div><div class=\"epl-title\">Fixture</div>",
                "/ep/1"=>$"<option value=\"{embed}\" data-index=\"1\">Server 1</option>",
                "/player"=>"{\"manifestUrl\":\"https://cdn.example/video.m3u8\"}",
                _=>throw new InvalidOperationException("Unexpected request.")};
            return Task.FromResult(new FetchResponse(200,r.Url,[],body));
        }
    }
}
