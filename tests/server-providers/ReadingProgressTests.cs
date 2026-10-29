using System.Text.Json;

namespace Vestra.Providers.Tests;

public sealed class ReadingProgressTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "vestra-progress-" + Guid.NewGuid().ToString("N"));
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

    [Fact]
    public void SavesSurviveRestartAndRemainScoped()
    {
        var store = new ReadingProgressStore(directory);
        Assert.Null(store.Read("source", "book"));
        var saved = store.Save("source", "book", "chapter", 1, 2);
        var restarted = new ReadingProgressStore(directory);
        Assert.Equal(saved, restarted.Read("source", "book"));
        Assert.Null(restarted.Read("other", "book"));
        Assert.Null(restarted.Read("source", "other"));
        Assert.Empty(Directory.GetFiles(directory, "*.tmp", SearchOption.AllDirectories));
    }
    [Fact]
    public void CoverMetadataSurvivesRestartAndSavesWithoutNewArtwork()
    {
        var cover = new ReadingCover("https://images.example/cover.jpg", new() { ["Referer"] = "https://manga.example/" });
        var store = new ReadingProgressStore(directory);
        store.Save("source", "book", "chapter", 0, 2, "Manga", cover);
        var restarted = new ReadingProgressStore(directory);
        restarted.Save("source", "book", "chapter", 1, 2, "Manga");
        var recent = Assert.Single(restarted.Recent("source").Entries);
        Assert.Equal(cover.Url, recent.Cover!.Url);
        Assert.Equal("https://manga.example/", recent.Cover.Headers!["Referer"]);
        Assert.Equal(1, recent.Progress.Page);
        Assert.Empty(restarted.Recent("other").Entries);
    }

    [Theory]
    [InlineData("http://images.example/cover.jpg")]
    [InlineData("https://user:pass@images.example/cover.jpg")]
    public void InvalidCoversCannotBePersisted(string url)
    {
        Assert.Throws<InvalidDataException>(() => new ReadingProgressStore(directory).Save("source", "book", "chapter", 0, 1, "Manga", new(url)));
    }
    [Fact]
    public void OversizedArtworkDoesNotBlockSavingTheReadingPosition()
    {
        var headers = Enumerable.Range(0, 16).ToDictionary(index => "X-Test-" + index, _ => new string('a', 4096));
        var store = new ReadingProgressStore(directory);
        store.Save("source", "book", "chapter", 0, 1, "Manga", new("https://images.example/cover.jpg", headers));
        Assert.Equal(0, store.Read("source", "book")!.Page);
        Assert.Null(Assert.Single(store.Recent("source").Entries).Cover);
    }

    [Fact]
    public void ImportPreservesTimestampAndCannotOverwriteExistingPosition()
    {
        var store = new ReadingProgressStore(directory);
        var legacy = new ReadingPosition("old-chapter", 3, DateTimeOffset.Parse("2026-01-01T00:00:00Z"));
        Assert.Equal(legacy, store.Import("source", "book", legacy));
        var latest = store.Save("source", "book", "new-chapter", 0, 1);
        Assert.Equal(latest, store.Import("source", "book", legacy));
    }

    [Theory]
    [InlineData(-1, 2)] [InlineData(2, 2)] [InlineData(0, 0)] [InlineData(2000, 2001)]
    public void InvalidPageBoundsAreRejected(int page, int count)
    {
        var store = new ReadingProgressStore(directory);
        Assert.Throws<ArgumentException>(() => store.Save("source", "book", "chapter", page, count));
        Assert.False(Directory.Exists(directory));
    }

    [Fact]
    public void InvalidIdentityAndMissingDirectoryAreRejected()
    {
        var store = new ReadingProgressStore(directory);
        Assert.Throws<ArgumentException>(() => store.Read("../escape", "book"));
        Assert.Throws<ArgumentException>(() => store.Save("source", "book", "", 0, 1));
        Assert.Throws<InvalidOperationException>(() => new ReadingProgressStore(null).Read("source", "book"));
        Assert.False(Directory.Exists(directory));
    }

    [Fact]
    public void CorruptOrOversizedFilesAreReportedAndPreserved()
    {
        var store = new ReadingProgressStore(directory);
        store.Save("source", "book", "chapter", 0, 1);
        var file = Assert.Single(Directory.GetFiles(directory, "*.json", SearchOption.AllDirectories));
        File.WriteAllText(file, "{broken");
        Assert.Throws<JsonException>(() => store.Read("source", "book"));
        Assert.Throws<JsonException>(() => store.Save("source", "book", "chapter", 0, 1));
        Assert.Equal("{broken", File.ReadAllText(file));
        File.WriteAllText(file, """{"version":1,"progress":{"chapterId":"chapter","updatedAt":"2026-01-01T00:00:00Z"}}""");
        Assert.Throws<JsonException>(() => store.Read("source", "book"));
        File.WriteAllText(file, new string(' ', 32769));
        Assert.Throws<InvalidDataException>(() => store.Read("source", "book"));
    }

    [Fact]
    public void RecentReadingsKeepTitlesAreScopedAndSurviveRestart()
    {
        var store = new ReadingProgressStore(directory);
        store.Import("source", "old", new("chapter", 0, DateTimeOffset.Parse("2026-01-01T00:00:00Z")));
        store.Save("source", "book", "chapter", 1, 2, "Saved manga");
        store.Save("other", "private", "chapter", 0, 1, "Other source");
        var result = new ReadingProgressStore(directory).Recent("source");
        Assert.Equal(new[] { "book", "old" }, result.Entries.Select(r => r.BookId));
        Assert.Equal("Saved manga", result.Entries[0].Title);
        Assert.Equal(1, result.Entries[0].Progress.Page);
        Assert.Equal(0, result.Unreadable);
        Assert.False(result.Truncated);
    }

    [Fact]
    public void VersionOnePositionsRemainReadableAndGainMetadataWhenSaved()
    {
        var store = new ReadingProgressStore(directory);
        store.Save("source", "book", "chapter", 0, 2);
        var file = Assert.Single(Directory.GetFiles(directory, "*.json", SearchOption.AllDirectories));
        File.WriteAllText(file, """{"version":1,"progress":{"chapterId":"chapter","page":1,"updatedAt":"2026-01-01T00:00:00Z"}}""");
        Assert.Equal(1, store.Read("source", "book")!.Page);
        Assert.Empty(store.Recent("source").Entries);
        store.Save("source", "book", "chapter", 1, 2, "Upgraded title");
        Assert.Equal("Upgraded title", Assert.Single(store.Recent("source").Entries).Title);
        using var document = JsonDocument.Parse(File.ReadAllText(file));
        Assert.Equal(1, document.RootElement.GetProperty("version").GetInt32());
        Assert.Equal(1, document.RootElement.GetProperty("progress").GetProperty("page").GetInt32());
    }

    [Fact]
    public void RecentReportsDamagedRecordsAndDoesNotOverwriteThem()
    {
        var store = new ReadingProgressStore(directory);
        store.Save("source", "book", "chapter", 0, 1);
        var file = Assert.Single(Directory.GetFiles(directory, "*.json", SearchOption.AllDirectories));
        File.WriteAllText(file, """{"version":99,"progress":{"chapterId":"chapter","page":0,"updatedAt":"2026-01-01T00:00:00Z"}}""");
        var result = store.Recent("source");
        Assert.Equal(1, result.Unreadable);
        Assert.Empty(result.Entries);
        Assert.Throws<InvalidDataException>(() => store.Save("source", "book", "chapter", 0, 1));
    }

    [Fact]
    public void RecentReturnsOnlyTwelveMostRecentPositions()
    {
        var store = new ReadingProgressStore(directory);
        for (var i = 0; i < 15; i++) store.Import("source", "book-" + i, new("chapter", 0, DateTimeOffset.Parse("2026-01-01T00:00:00Z").AddDays(i)));
        var entries = store.Recent("source").Entries;
        Assert.Equal(12, entries.Length);
        Assert.Equal("book-14", entries[0].BookId);
        Assert.Equal("book-3", entries[^1].BookId);
    }
}
