using System.Text.Json;
using System.Text.Json.Serialization;

namespace Vestra.Providers;

public sealed record SavedManga(string Kind, string Source, string Id, string Title, ReadingCover? Cover, DateTimeOffset SavedAt);

/// <summary>Series bookmarks are independent of chapter progress and survive source removal.</summary>
public sealed class MangaBookmarksStore(string? directory)
{
    private readonly object gate = new();
    private sealed record Document([property: JsonRequired] int Version, [property: JsonRequired] SavedManga[] Entries);
    private string FilePath => string.IsNullOrWhiteSpace(directory) ? throw new InvalidOperationException("Bookmarks require a persistent data directory.") : Path.Combine(Path.GetFullPath(directory), "manga-bookmarks.json");
    public SavedManga[] List() { lock (gate) return Read().OrderByDescending(row => row.SavedAt).ToArray(); }
    public void Set(string kind, string source, string id, string title, ReadingCover? cover, bool saved)
    {
        ValidateIdentity(kind, source, id);
        if (saved) { ValidateTitle(title); ReadingProgressStore.ValidateCover(cover); }
        lock (gate)
        {
            var rows = Read().ToList();
            var prior = rows.FirstOrDefault(row => row.Kind == kind && row.Source == source && row.Id == id);
            rows.RemoveAll(row => row.Kind == kind && row.Source == source && row.Id == id);
            if (saved) rows.Add(new(kind, source, id, title, cover ?? prior?.Cover, prior?.SavedAt ?? DateTimeOffset.UtcNow));
            if (rows.Count > 500) throw new InvalidOperationException("The manga library supports at most 500 bookmarks.");
            var document = new Document(1, rows.ToArray());
            var bytes = JsonSerializer.SerializeToUtf8Bytes(document, ProviderRuntime.JsonOptions);
            if (bytes.Length > 1_048_576 && saved)
            {
                rows[^1] = rows[^1] with { Cover = null };
                bytes = JsonSerializer.SerializeToUtf8Bytes(new Document(1, rows.ToArray()), ProviderRuntime.JsonOptions);
            }
            if (bytes.Length > 1_048_576) throw new InvalidOperationException("Manga bookmark metadata exceeds 1 MiB.");
            var file = FilePath; Directory.CreateDirectory(Path.GetDirectoryName(file)!);
            var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try { File.WriteAllBytes(temporary, bytes); File.Move(temporary, file, true); }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
    }
    private SavedManga[] Read()
    {
        var file = FilePath;
        if (!File.Exists(file)) return [];
        if (new FileInfo(file).Length > 1_048_576) throw new InvalidDataException("Manga bookmark metadata exceeds 1 MiB.");
        var document = JsonSerializer.Deserialize<Document>(File.ReadAllBytes(file), ProviderRuntime.JsonOptions);
        if (document?.Version != 1 || document.Entries is null || document.Entries.Length > 500) throw new InvalidDataException("Invalid manga bookmark document.");
        var seen = new HashSet<string>();
        foreach (var row in document.Entries)
        {
            if (row is null || row.SavedAt == default) throw new InvalidDataException("Invalid manga bookmark.");
            ValidateIdentity(row.Kind, row.Source, row.Id); ValidateTitle(row.Title); ReadingProgressStore.ValidateCover(row.Cover);
            if (!seen.Add(JsonSerializer.Serialize(new[] { row.Kind, row.Source, row.Id }))) throw new InvalidDataException("Duplicate manga bookmark.");
        }
        return document.Entries;
    }
    private static void ValidateTitle(string title) { if (string.IsNullOrWhiteSpace(title) || title.Length > 4096) throw new InvalidDataException("Invalid bookmark title."); }
    private static void ValidateIdentity(string kind, string source, string id)
    {
        if (kind is not ("source" or "catalogue") || string.IsNullOrWhiteSpace(source) || source.Length > 120 || source.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not '-' and not '_' and not '.') || string.IsNullOrWhiteSpace(id) || id.Length > 4096)
            throw new InvalidDataException("Invalid manga bookmark identity.");
        if (kind == "catalogue" && (source != "anilist" || !int.TryParse(id, out var number) || number <= 0)) throw new InvalidDataException("Invalid catalogue bookmark identity.");
    }
}
