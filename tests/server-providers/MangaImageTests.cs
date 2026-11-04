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
    [Theory]
    [InlineData(3 * 1024 * 1024)]
    [InlineData(MangaImage.MaxBytes)]
    public void AcceptsBoundedLargeRasterPages(int size)
    {
        var bytes=new byte[size]; bytes[0]=0xff; bytes[1]=0xd8; bytes[2]=0xff;
        var result=JsonSerializer.SerializeToElement(MangaImage.Encode(new(200,"https://fixture.example/page",new(){["Content-Type"]="application/octet-stream"},bytes,"OK")));
        Assert.Equal(size,Convert.FromBase64String(result.GetProperty("data").GetString()!).Length);
    }

    [Fact]
    public void RejectsImagesAboveTheHostLimit()
    {
        Assert.Throws<InvalidOperationException>(()=>MangaImage.Encode(new(200,"https://fixture.example/page",new(){["Content-Type"]="image/jpeg"},new byte[MangaImage.MaxBytes+1],"OK")));
    }
}
