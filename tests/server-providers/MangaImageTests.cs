using System.Text.Json;
namespace Vestra.Providers.Tests;
public sealed class MangaImageTests
{
 [Fact] public void BinaryDataIsPreservedExactly(){var bytes=new byte[]{0,255,128,1,2};var value=JsonSerializer.SerializeToElement(MangaImage.Encode(new(200,"https://images.example/a",new(StringComparer.OrdinalIgnoreCase){{"Content-Type","image/png"}},bytes,"OK")));Assert.Equal(bytes,Convert.FromBase64String(value.GetProperty("data").GetString()!));}
 [Theory][InlineData("text/html")][InlineData("image/svg+xml")][InlineData("application/octet-stream")]
 public void NonRasterResponsesAreRejected(string type)=>Assert.Throws<InvalidOperationException>(()=>MangaImage.Encode(new(200,"https://images.example/a",new(){{"Content-Type",type}},[1],"OK")));
 [Fact] public void DeniedAndOversizedImagesAreRejected(){Assert.Throws<InvalidOperationException>(()=>MangaImage.Encode(new(403,"https://images.example/a",new(){{"Content-Type","image/png"}},[1],"Forbidden")));Assert.Throws<InvalidOperationException>(()=>MangaImage.Encode(new(200,"https://images.example/a",new(){{"Content-Type","image/png"}},new byte[2097153],"OK")));}
}
