using System.Text.Json;

namespace Vestra.Providers.Tests;
public sealed class ProviderStoreTests
{
    private static string Source(string body) => "class Provider { getSettings(){"+body+"} search(){return [];} findEpisodes(){return [];} findEpisodeServer(){throw new Error('unused');}}";
    private sealed class NoNetwork:IProviderTransport
    {
        public Task<FetchResponse> FetchAsync(FetchRequest r,IReadOnlySet<string> h,CancellationToken ct)=>throw new InvalidOperationException();
    }
    private static async Task<JsonElement> Call(ProviderStore store,string id,string body)
    {
        var runtime=new ProviderRuntime(new NoNetwork(),store:store);
        await runtime.LoadAsync(new(id,Source(body),[]));return await runtime.CallAsync(id,"getSettings",[]);
    }
    [Fact]
    public async Task PersistsNullAndObjectsAcrossRuntimeAndKeepsProvidersSeparate()
    {
        var path=Path.Combine(Path.GetTempPath(),"vestra-store-"+Guid.NewGuid().ToString("N"));
        try
        {
            await Call(new(path),"first","$store.set('x',{a:3});$store.set('nil',null);return {supportsDub:false,episodeServers:[]};");
            var r=await Call(new(path),"first","return {supportsDub:false,episodeServers:[String($store.get('x').a),String($store.get('nil')===null),String($store.get('missing')===undefined)]};");
            Assert.Equal(new[]{"3","true","true"},r.GetProperty("episodeServers").Deserialize<string[]>());
            Assert.Empty((await Call(new(path),"second","return {supportsDub:false,episodeServers:$store.get('x')===undefined?[]:['wrong']};")).GetProperty("episodeServers").EnumerateArray());
            await Call(new(path),"first","$store.delete('x');$store.clear();return {supportsDub:false,episodeServers:[]};");
            Assert.Equal("0",(await Call(new(path),"first","return {supportsDub:false,episodeServers:[String($store.length())]};")).GetProperty("episodeServers")[0].GetString());
        }
        finally {if(Directory.Exists(path))Directory.Delete(path,true);}
    }
    [Fact]
    public async Task FailedQuotaWritePreservesExistingData()
    {
        var store=new ProviderStore();
        await Call(store,"p","$store.set('safe',7);return {supportsDub:false,episodeServers:[]};");
        await Assert.ThrowsAnyAsync<Exception>(()=>Call(store,"p","$store.set('large','x'.repeat(300000));return {supportsDub:false,episodeServers:[]};"));
        Assert.Equal("7",(await Call(store,"p","return {supportsDub:false,episodeServers:[String($store.get('safe'))]};")).GetProperty("episodeServers")[0].GetString());
    }
    [Fact]
    public async Task CorruptFileIsNotOverwritten()
    {
        var path=Path.Combine(Path.GetTempPath(),"vestra-corrupt-"+Guid.NewGuid().ToString("N"));
        try
        {
            await Call(new(path),"p","$store.set('key',1);return {supportsDub:false,episodeServers:[]};");
            var file=Directory.GetFiles(path,"*.json").Single();await File.WriteAllTextAsync(file,"corrupt");
            await Assert.ThrowsAnyAsync<Exception>(()=>Call(new(path),"p","$store.set('key',2);return {supportsDub:false,episodeServers:[]};"));
            Assert.Equal("corrupt",await File.ReadAllTextAsync(file));
        }
        finally {if(Directory.Exists(path))Directory.Delete(path,true);}
    }
}
