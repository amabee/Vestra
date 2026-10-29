using System.Text.Json;

namespace Vestra.Providers.Tests;
public sealed class FetchCompatibilityTests
{
    private sealed class Transport:IProviderTransport
    {
        public List<FetchRequest> Requests {get;}=[];
        public Task<FetchResponse> FetchAsync(FetchRequest r,IReadOnlySet<string> h,CancellationToken ct)
        {
            ProviderHttpTransport.ValidateDestination(new Uri(r.Url),h);Requests.Add(r);
            return Task.FromResult(new FetchResponse(200,r.Url,new(){{"Content-Type","application/json"}},"{\"result\":\"fixture\"}","200 OK"));
        }
    }
    private static async Task<(string[],Transport)> Run(string body)
    {
        var transport=new Transport();var runtime=new ProviderRuntime(transport);
        var source="class Provider {async getSettings(){"+body+"}search(){return [];}findEpisodes(){return [];}findEpisodeServer(){throw new Error('unused');}}";
        await runtime.LoadAsync(new("fetch-test",source,["fixture.example"]));
        var r=await runtime.CallAsync("fetch-test","getSettings",[]);
        return (r.GetProperty("episodeServers").Deserialize<string[]>()!,transport);
    }
    [Fact]
    public async Task ResponseMethodsSupportSeanimeSynchronousAndAwaitedUse()
    {
        var (r,_)=await Run("""
          const response=await fetch('https://fixture.example/');
          return {supportsDub:false,episodeServers:[response.json().result,(await response.json()).result,
            String(typeof response.text()),response.statusText,response.headers['Content-Type'],response.headers.get('content-type')]};
          """);
        Assert.Equal(new[]{"fixture","fixture","string","200 OK","application/json","application/json"},r);
    }
    [Fact]
    public async Task HeadersAndJsonBodyAreNormalized()
    {
        var (r,t)=await Run("""
          const h=new Headers([['X-Test','a']]);h.append('x-test','b');h.set('Accept','application/json');
          await fetch('https://fixture.example/',{method:'POST',headers:h,body:{query:'世'}});
          return {supportsDub:false,episodeServers:[h.get('X-Test'),String(h.has('ACCEPT'))]};
          """);
        Assert.Equal(new[]{"a, b","true"},r);
        Assert.Equal("application/json",t.Requests[0].Headers!["content-type"]);
        Assert.Equal("世",JsonDocument.Parse(t.Requests[0].Body!).RootElement.GetProperty("query").GetString());
    }
    [Fact]
    public async Task TextFormDataHasStableBoundaryAndEncodesFields()
    {
        var (r,t)=await Run("""
          const f=new FormData();f.append('a','one');f.append('a','two');f.set('b','世');
          const type=f.getContentType();const buffer=f.getBuffer();
          await fetch('https://fixture.example/',{method:'POST',body:f});
          return {supportsDub:false,episodeServers:[f.getAll('a').join('|'),String(buffer.toString().includes('世')),String(type===f.getContentType())]};
          """);
        Assert.Equal(new[]{"one|two","true","true"},r);
        Assert.StartsWith("multipart/form-data; boundary=",t.Requests[0].Headers!["content-type"]);
        Assert.Contains("one",t.Requests[0].Body!);Assert.Contains("two",t.Requests[0].Body!);Assert.Contains("世",t.Requests[0].Body!);
    }
    [Fact]
    public async Task UrlEncodedBodyIsSerializedForFetch()
    {
        var (_,t)=await Run("await fetch('https://fixture.example/',{method:'POST',body:new URLSearchParams({q:'a b'})});return {supportsDub:false,episodeServers:[]};");
        Assert.Equal("q=a+b",t.Requests[0].Body);
        Assert.Equal("application/x-www-form-urlencoded;charset=UTF-8",t.Requests[0].Headers!["content-type"]);
    }
    [Theory]
    [InlineData("new Headers({'bad name':'x'})")]
    [InlineData("new Headers({'x':'bad\\r\\nInjected: x'})")]
    [InlineData("const f=new FormData();f.append('file',{},'a.txt')")]
    public async Task UnsupportedAndInvalidRequestInputsFail(string expression)=>
        await Assert.ThrowsAnyAsync<Exception>(()=>Run(expression+";return {supportsDub:false,episodeServers:[]};"));
}
