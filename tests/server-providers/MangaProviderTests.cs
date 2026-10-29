using System.Text.Json;

namespace Vestra.Providers.Tests;
public sealed class MangaProviderTests
{
    private const string Source="""
      class Provider {
        getSettings(){return {supportsMultiLanguage:true,supportsMultiScanlator:true};}
        async search(opts){const r=await fetch('https://manga.example/search?q='+encodeURIComponent(opts.query));return r.json();}
        findChapters(id){return [{provider:'forged',id:id+'$ch1',url:'https://manga.example/ch1',title:'Chapter 1.5',chapter:'1.5',index:0,language:'en',scanlator:'Group'}];}
        findChapterPages(id){return [{provider:'forged',url:'https://images.example/2.jpg',index:1,headers:{Referer:'https://manga.example/ch1'}},{url:'https://images.example/1.jpg',index:0,headers:{Referer:'https://manga.example/ch1'}}];}
      }
      """;
    private static JsonElement J(object value)=>JsonSerializer.SerializeToElement(value);
    [Fact]
    public async Task MangaContractPreservesChapterMetadataHeadersAndPageOrder()
    {
        var runtime=new ProviderRuntime(new Transport());
        var methods=await runtime.LoadAsync(new("manga",Source,["manga.example"],Type:"manga-provider"));
        Assert.Contains("findChapterPages",methods);Assert.DoesNotContain("findEpisodes",methods);
        var search=await runtime.CallAsync("manga","search",[J(new {query="Fixture",year=2020})]);
        Assert.Equal("manga",search[0].GetProperty("provider").GetString());
        var chapters=await runtime.CallAsync("manga","findChapters",[search[0].GetProperty("id")]);
        Assert.Equal("manga",chapters[0].GetProperty("provider").GetString());
        Assert.Equal("1.5",chapters[0].GetProperty("chapter").GetString());
        Assert.Equal("en",chapters[0].GetProperty("language").GetString());
        var pages=await runtime.CallAsync("manga","findChapterPages",[chapters[0].GetProperty("id")]);
        Assert.Equal(1,pages[0].GetProperty("index").GetInt32());
        Assert.Equal(0,pages[1].GetProperty("index").GetInt32());
        Assert.Equal("manga",pages[1].GetProperty("provider").GetString());
        Assert.Equal("https://manga.example/ch1",pages[0].GetProperty("headers").GetProperty("Referer").GetString());
        var settings=await runtime.CallAsync("manga","getSettings",[]);
        Assert.True(settings.GetProperty("supportsMultiScanlator").GetBoolean());
        await Assert.ThrowsAsync<ArgumentException>(()=>runtime.CallAsync("manga","findEpisodes",[J("id")]));
        await Assert.ThrowsAsync<ArgumentException>(()=>runtime.CallAsync("manga","findChapters",[J(3)]));
    }
    [Theory]
    [InlineData("index:1","index:-1")]
    [InlineData("https://images.example/2.jpg","file:///secret")]
    [InlineData("Referer:'https://manga.example/ch1'","Referer:'bad\\r\\nInjected: true'")]
    public async Task MalformedPagesAreRejected(string before,string after)
    {
        var runtime=new ProviderRuntime(new Transport());
        await runtime.LoadAsync(new("m",Source.Replace(before,after),[],Type:"manga-provider"));
        await Assert.ThrowsAnyAsync<Exception>(()=>runtime.CallAsync("m","findChapterPages",[J("chapter")]));
    }
    [Fact]
    public async Task ContractTypesAndRequiredMethodsAreCheckedAtLoad()
    {
        var runtime=new ProviderRuntime(new Transport());
        await Assert.ThrowsAsync<ArgumentException>(()=>runtime.LoadAsync(new("m",Source,[])));
        await Assert.ThrowsAsync<ArgumentException>(()=>runtime.LoadAsync(new("m",Source,[],Type:"plugin")));
        await Assert.ThrowsAsync<ArgumentException>(()=>runtime.LoadAsync(new("m",Source.Replace("findChapters(id)","missing(id)"),[],Type:"manga-provider")));
        await runtime.LoadAsync(new("m",Source,[],Type:"manga-provider"));
        await Assert.ThrowsAsync<InvalidOperationException>(async()=>{
            await runtime.LoadAsync(new("bad",Source.Replace("supportsMultiLanguage:true","supportsMultiLanguage:'true'"),[],Type:"manga-provider"));
            await runtime.CallAsync("bad","getSettings",[]);
        });
    }
    [Fact]
    public async Task OptionalManganatoArtifactCompletesOfflineFlow()
    {
        var path=Environment.GetEnvironmentVariable("VESTRA_TEST_MANGA_PROVIDER");if(path is null)return;
        var transport=new Transport();var runtime=new ProviderRuntime(transport);
        await runtime.LoadAsync(new("artifact",await File.ReadAllTextAsync(path),["www.mangabats.com"],Type:"manga-provider"));
        var found=await runtime.CallAsync("artifact","search",[J(new {query="Fixture",year=0})]);Assert.Single(found.EnumerateArray());
        var chapters=await runtime.CallAsync("artifact","findChapters",[found[0].GetProperty("id")]);Assert.Single(chapters.EnumerateArray());
        var pages=await runtime.CallAsync("artifact","findChapterPages",[chapters[0].GetProperty("id")]);Assert.Equal(2,pages.GetArrayLength());
        Assert.Equal("https://images.example/1.jpg",pages[0].GetProperty("url").GetString());
        Assert.Equal(3,transport.Calls);
    }
    private sealed class Transport:IProviderTransport
    {
        public int Calls{get;private set;}
        public Task<FetchResponse> FetchAsync(FetchRequest r,IReadOnlySet<string> h,CancellationToken ct)
        {
            ProviderHttpTransport.ValidateDestination(new Uri(r.Url),h);Calls++;
            var uri=new Uri(r.Url);
            var body=uri.AbsolutePath switch {
                "/search"=>"[{\"provider\":\"forged\",\"id\":\"fixture\",\"title\":\"Fixture\",\"synonyms\":[\"Alt\"],\"image\":\"https://images.example/cover.jpg\"}]",
                "/search/story/Fixture"=>"<div class=\"story_item\"><a href=\"https://www.mangabats.com/manga/fixture\"><img src=\"https://images.example/cover.jpg\"></a><div class=\"story_name\"><a>Fixture</a></div></div>",
                "/api/manga/fixture/chapters"=>"{\"success\":true,\"data\":{\"chapters\":[{\"chapter_num\":\"1.5\",\"chapter_slug\":\"chapter-1.5\",\"chapter_name\":\"Chapter 1.5\"}]}}",
                "/manga/fixture/chapter-1.5"=>"<script>var cdns = [\"https://images.example/\"]; var chapterImages = [\"1.jpg\",\"2.jpg\"];</script>",
                _=>throw new InvalidOperationException("Unexpected fixture request.")};
            return Task.FromResult(new FetchResponse(200,r.Url,[],body));
        }
    }
}
