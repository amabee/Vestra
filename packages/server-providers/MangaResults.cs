using System.Text.Json;
using System.Text.Json.Nodes;
using static Vestra.Providers.ProviderResults;

namespace Vestra.Providers;

internal static class MangaResults
{
    public static JsonElement Validate(string id, string method, JsonElement result)
    {
        if (method == "getSettings")
        {
            Require(result.ValueKind == JsonValueKind.Object, "Expected manga settings object.");
            foreach (var field in new[] { "supportsMultiScanlator", "supportsMultiLanguage" })
                Require(result.TryGetProperty(field, out var flag) && flag.ValueKind is JsonValueKind.True or JsonValueKind.False, $"Invalid {field}.");
            return result;
        }
        var limit = method == "findChapters" ? 10000 : 2000;
        Require(result.ValueKind == JsonValueKind.Array && result.GetArrayLength() <= limit, $"Expected at most {limit} manga records.");
        foreach (var row in result.EnumerateArray())
        {
            Require(row.ValueKind == JsonValueKind.Object, "Expected manga record object.");
            if (method == "search")
            {
                Text(row, "id"); Text(row, "title");
                if (row.TryGetProperty("image", out var image) && image.ValueKind != JsonValueKind.Null && image.GetString() != "") Url(row, "image");
                if (row.TryGetProperty("imageHeaders", out var headers) && headers.ValueKind != JsonValueKind.Null) ValidateHeaders(headers);
                if (row.TryGetProperty("synonyms", out var synonyms) && synonyms.ValueKind != JsonValueKind.Null)
                {
                    Require(synonyms.ValueKind == JsonValueKind.Array && synonyms.GetArrayLength() <= 100, "Invalid manga synonyms.");
                    foreach (var synonym in synonyms.EnumerateArray()) Require(synonym.ValueKind == JsonValueKind.String && synonym.GetString()!.Length <= 4096, "Invalid manga synonym.");
                }
                if (row.TryGetProperty("searchRating", out var rating)) Require(rating.TryGetDouble(out var value) && double.IsFinite(value) && value is >= 0 and <= 1, "Invalid search rating.");
            }
            else
            {
                Url(row, "url");
                Require(row.TryGetProperty("index", out var index) && index.TryGetInt32(out var n) && n >= 0, "Invalid manga index.");
                if (method == "findChapters")
                {
                    Text(row, "id"); Text(row, "title"); Text(row, "chapter");
                    Text(row, "language", true); Text(row, "scanlator", true);
                }
                else if (row.TryGetProperty("headers", out var headers) && headers.ValueKind != JsonValueKind.Null) ValidateHeaders(headers);
            }
        }
        var array = JsonNode.Parse(result.GetRawText())!.AsArray();
        foreach (var row in array) row!["provider"] = id;
        return JsonSerializer.SerializeToElement(array);
    }
}
