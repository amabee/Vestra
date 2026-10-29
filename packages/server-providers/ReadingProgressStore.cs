using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Vestra.Providers;

public sealed record ReadingPosition(
    [property: JsonRequired] string ChapterId,
    [property: JsonRequired] int Page,
    [property: JsonRequired] DateTimeOffset UpdatedAt);
public sealed record ReadingCover(string Url, Dictionary<string, string>? Headers = null);
public sealed record RecentReading(string ProviderId, string BookId, string Title, ReadingPosition Progress, ReadingCover? Cover = null);
public sealed record RecentReadings(RecentReading[] Entries, int Unreadable, bool Truncated);

/// <summary>Host-owned reading state. Never bound into a provider's JavaScript engine.</summary>
public sealed class ReadingProgressStore(string? directory)
{
    private readonly object gate = new();
    private sealed record Document([property: JsonRequired] int Version, [property: JsonRequired] ReadingPosition Progress,
        string? ProviderId = null, string? BookId = null, string? Title = null, ReadingCover? Cover = null);

    public ReadingPosition? Read(string provider, string book)
    {
        lock (gate) return ReadFor(provider, book)?.Progress;
    }

    public ReadingPosition Save(string provider, string book, string chapter, int page, int pageCount, string? title = null, ReadingCover? cover = null)
    {
        if (pageCount is < 1 or > 2000 || page < 0 || page >= pageCount)
            throw new ArgumentException("Invalid reading position.");
        var value = new ReadingPosition(chapter, page, DateTimeOffset.UtcNow);
        Validate(value);
        ValidateCover(cover);
        if (title is not null && (string.IsNullOrWhiteSpace(title) || title.Length > 4096)) throw new ArgumentException("Invalid manga title.");
        lock (gate)
        {
            var file = FileFor(provider, book);
            // Surface corruption rather than silently replacing a damaged document.
            var previous = ReadFor(provider, book);
            // Add optional metadata without changing the v1 progress shape older builds read.
            var document = new Document(1, value, provider, book, title ?? previous?.Title ?? book, cover ?? previous?.Cover);
            // Optional artwork must not consume the position document's budget.
            if (document.Cover is not null && JsonSerializer.SerializeToUtf8Bytes(document, ProviderRuntime.JsonOptions).Length > 32768)
                document = document with { Cover = null };
            Write(file, document);
            return value;
        }
    }

    public ReadingPosition Import(string provider, string book, ReadingPosition value)
    {
        Validate(value);
        lock (gate)
        {
            var file = FileFor(provider, book);
            var existing = ReadFor(provider, book);
            if (existing is not null) return existing.Progress;
            Write(file, new Document(1, value, provider, book, book));
            return value;
        }
    }
    public bool SetCover(string provider, string book, ReadingCover cover)
    {
        ValidateCover(cover);
        lock (gate)
        {
            var file = FileFor(provider, book);
            var current = ReadFor(provider, book);
            if (current is null) return false;
            var updated = current with { Cover = cover };
            if (JsonSerializer.SerializeToUtf8Bytes(updated, ProviderRuntime.JsonOptions).Length > 32768) return false;
            Write(file, updated);
            return true;
        }
    }

    public RecentReadings Recent(string provider)
    {
        lock (gate)
        {
            var folder = Path.GetDirectoryName(FileFor(provider, "_"))!;
            if (!Directory.Exists(folder)) return new([], 0, false);
            // Bound disk work even for a large library. Report an incomplete scan.
            var files = Directory.EnumerateFiles(folder, "*.json").Take(1025).ToArray();
            var entries = new List<RecentReading>();
            var unreadable = 0;
            foreach (var file in files.Take(1024))
            {
                try
                {
                    var document = ReadFile(file);
                    if (document?.ProviderId is null) continue;
                    if (!string.Equals(FileFor(document.ProviderId, document.BookId!), file, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("Reading progress identity mismatch.");
                    if (document.ProviderId != provider) continue;
                    entries.Add(new(provider, document.BookId!, document.Title!, document.Progress, document.Cover));
                }
                catch (Exception error) when (error is IOException or InvalidDataException or JsonException or ArgumentException or UnauthorizedAccessException)
                { unreadable++; }
            }
            return new(entries.OrderByDescending(r => r.Progress.UpdatedAt).ThenBy(r => r.BookId, StringComparer.Ordinal).Take(12).ToArray(), unreadable, files.Length > 1024);
        }
    }

    private Document? ReadFor(string provider, string book)
    {
        var document = ReadFile(FileFor(provider, book));
        if (document?.ProviderId is not null && (document.ProviderId != provider || document.BookId != book))
            throw new InvalidDataException("Reading progress identity mismatch.");
        return document;
    }

    private string FileFor(string provider, string book)
    {
        if (string.IsNullOrWhiteSpace(provider) || provider.Length > 120 ||
            provider.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not '-' and not '_' and not '.'))
            throw new ArgumentException("Invalid provider ID.");
        if (string.IsNullOrWhiteSpace(book) || book.Length > 4096)
            throw new ArgumentException("Invalid manga ID.");
        if (string.IsNullOrWhiteSpace(directory))
            throw new InvalidOperationException("Reading progress requires a persistent data directory.");
        var key = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new[] { provider, book })));
        return Path.Combine(Path.GetFullPath(directory), "reading-progress", key + ".json");
    }

    private static void Validate(ReadingPosition value)
    {
        if (string.IsNullOrWhiteSpace(value.ChapterId) || value.ChapterId.Length > 4096 ||
            value.Page is < 0 or >= 2000 || value.UpdatedAt == default)
            throw new ArgumentException("Invalid reading position.");
    }

    private static Document? ReadFile(string file)
    {
        try
        {
            using var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (input.Length > 32768) throw new InvalidDataException("Reading progress exceeds 32 KiB.");
            var document = JsonSerializer.Deserialize<Document>(input, ProviderRuntime.JsonOptions);
            if (document is null || document.Version != 1 || document.Progress is null)
                throw new InvalidDataException("Invalid reading progress document.");
            Validate(document.Progress);
            ValidateCover(document.Cover);
            if ((document.ProviderId is not null || document.BookId is not null || document.Title is not null) && (string.IsNullOrWhiteSpace(document.ProviderId) || document.ProviderId.Length > 120 ||
                string.IsNullOrWhiteSpace(document.BookId) || document.BookId.Length > 4096 || string.IsNullOrWhiteSpace(document.Title) || document.Title.Length > 4096))
                throw new InvalidDataException("Invalid reading progress metadata.");
            return document;
        }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
    }

    private static void Write(string file, Document value)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var temp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(value, ProviderRuntime.JsonOptions);
            if (bytes.Length > 32768) throw new InvalidDataException("Reading progress exceeds 32 KiB.");
            using (var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                output.Write(bytes);
                output.Flush(true);
            }
            File.Move(temp, file, true);
        }
        finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    private static void ValidateCover(ReadingCover? cover)
    {
        if (cover is null) return;
        if (cover.Url is null || cover.Url.Length > 4096 || !Uri.TryCreate(cover.Url, UriKind.Absolute, out var uri) ||
            uri.Scheme != "https" || !string.IsNullOrEmpty(uri.UserInfo)) throw new InvalidDataException("Invalid manga cover URL.");
        try { ProviderResults.ValidateHeaders(JsonSerializer.SerializeToElement(cover.Headers ?? [])); }
        catch (InvalidOperationException error) { throw new InvalidDataException("Invalid manga cover headers.", error); }
    }
}
