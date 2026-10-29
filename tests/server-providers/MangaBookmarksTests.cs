namespace Vestra.Providers.Tests;

public sealed class MangaBookmarksTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "vestra-bookmarks-" + Guid.NewGuid().ToString("N"));
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
    [Fact]
    public void SourceAndCatalogueBookmarksSurviveRestartWithoutReadingProgress()
    {
        var store = new MangaBookmarksStore(directory);
        store.Set("source", "source-a", "book", "Source manga", new("https://images.example/cover.jpg"), true);
        store.Set("catalogue", "anilist", "123", "Catalogue manga", null, true);
        store.Set("source", "source-b", "book", "Different source", null, true);
        var rows = new MangaBookmarksStore(directory).List();
        Assert.Equal(3, rows.Length);
        Assert.Contains(rows, row => row.Kind == "source" && row.Source == "source-a" && row.Cover!.Url == "https://images.example/cover.jpg");
        Assert.Contains(rows, row => row.Kind == "catalogue" && row.Id == "123");
        Assert.False(Directory.Exists(Path.Combine(directory, "reading-progress")));
        var saved = rows.Single(row => row.Source == "source-a").SavedAt;
        store.Set("source", "source-a", "book", "Updated name", null, true);
        Assert.Equal(saved, store.List().Single(row => row.Source == "source-a").SavedAt);
        store.Set("source", "source-a", "book", "", null, false);
        Assert.Equal(2, new MangaBookmarksStore(directory).List().Length);
    }
    [Theory]
    [InlineData("other", "source", "book")]
    [InlineData("source", "../escape", "book")]
    [InlineData("catalogue", "source", "1")]
    [InlineData("catalogue", "anilist", "not-an-id")]
    public void InvalidBookmarksAreRejected(string kind, string source, string id)
    {
        Assert.Throws<InvalidDataException>(() => new MangaBookmarksStore(directory).Set(kind, source, id, "Title", null, true));
        Assert.False(Directory.Exists(directory));
    }
    [Fact]
    public void CorruptFilesAreReportedAndPreserved()
    {
        var store = new MangaBookmarksStore(directory);
        store.Set("source", "one", "book", "Title", null, true);
        var file = Path.Combine(directory, "manga-bookmarks.json");
        File.WriteAllText(file, "{broken");
        Assert.Throws<System.Text.Json.JsonException>(() => store.List());
        Assert.Throws<System.Text.Json.JsonException>(() => store.Set("source", "one", "other", "Other", null, true));
        Assert.Equal("{broken", File.ReadAllText(file));
    }
}
