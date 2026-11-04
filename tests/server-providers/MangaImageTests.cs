using System.Text;
using System.Text.Json;
using Vestra.Providers;

public class MangaImageTests
{
    [Theory]
    [InlineData("ffd8ffe0", "image/jpeg")]
    [InlineData("89504e470d0a1a0a", "image/png")]
    [InlineData("474946383961", "image/gif")]
    [InlineData("524946460000000057454250", "image/webp")]
    [InlineData("000000186674797061766966", "image/avif")]
    public void RecognizesRasterDataFromGenericBinaryCdn(string hex, string mime)
    {
        var bytes=Convert.FromHexString(hex);
        var response=new BinaryFetchResponse(200,"https://fixture.example/page",new(){["Content-Type"]="application/octet-stream"},bytes,"OK");
        var result=JsonSerializer.SerializeToElement(MangaImage.Encode(response));
        Assert.Equal(mime,result.GetProperty("mimeType").GetString());
        Assert.Equal(bytes,Convert.FromBase64String(result.GetProperty("data").GetString()!));
    }

    [Theory]
    [InlineData("<html>Verification required</html>")]
    [InlineData("<svg xmlns='http://www.w3.org/2000/svg'></svg>")]
    public void RejectsMarkupMasqueradingAsBinaryImages(string body)
    {
        var response=new BinaryFetchResponse(200,"https://fixture.example/page",new(){["Content-Type"]="application/octet-stream"},Encoding.UTF8.GetBytes(body),"OK");
        Assert.Throws<InvalidOperationException>(()=>MangaImage.Encode(response));
    }
}
