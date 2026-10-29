using System.Text.Json;

namespace Vestra.Providers.Tests;
public sealed class SubtitleMetadataTests
{
    private static JsonElement Result(object subtitle) => JsonSerializer.SerializeToElement(new {
        server = "main", videoSources = new[] { new { url = "https://cdn.example/video.m3u8", type = "m3u8", subtitles = new[] { subtitle } } }
    });
    [Fact] public void SubtitleMetadataIsPreserved() {
        var result = ProviderResults.Validate("fixture", "findEpisodeServer", Result(new { url = "https://cdn.example/en.vtt", language = "en", title = "English captions", isDefault = true }));
        var subtitle = result.GetProperty("videoSources")[0].GetProperty("subtitles")[0];
        Assert.Equal("English captions", subtitle.GetProperty("title").GetString());
        Assert.True(subtitle.GetProperty("isDefault").GetBoolean());
    }
    [Fact] public void MalformedSubtitleMetadataIsRejected() {
        Assert.Throws<InvalidOperationException>(() => ProviderResults.Validate("fixture", "findEpisodeServer", Result(new { url = "https://cdn.example/en.vtt", language = "en", title = new string('x',201) })));
        Assert.Throws<InvalidOperationException>(() => ProviderResults.Validate("fixture", "findEpisodeServer", Result(new { url = "https://cdn.example/en.vtt", language = "en", isDefault = "yes" })));
    }
}
