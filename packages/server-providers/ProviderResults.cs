using System.Text.Json;
using System.Text.Json.Nodes;

namespace Vestra.Providers;

public static class ProviderResults
{
    public static JsonElement Validate(string id, string method, JsonElement result)
    {
        if (method is "search" or "findEpisodes")
        {
            Require(result.ValueKind == JsonValueKind.Array && result.GetArrayLength() <= 2000, "Expected at most 2000 results.");
            foreach (var item in result.EnumerateArray())
            {
                Text(item, "id");
                Text(item, "title", optional: method == "findEpisodes");
                Url(item, "url");
                if (method == "findEpisodes")
                    Require(item.TryGetProperty("number", out var n) && n.TryGetDouble(out var number) && number >= 0 && double.IsFinite(number), "Invalid episode number.");
            }
        }
        else if (method == "findEpisodeServer")
        {
            Text(result, "server");
            if (result.TryGetProperty("headers", out var headers)) ValidateHeaders(headers);
            Require(result.TryGetProperty("videoSources", out var sources) && sources.ValueKind == JsonValueKind.Array && sources.GetArrayLength() is > 0 and <= 100, "Expected 1-100 video sources.");
            foreach (var source in sources.EnumerateArray())
            {
                Url(source, "url");
                var type = Text(source, "type");
                Require(type is "mp4" or "m3u8" or "hls" or "unknown", "Unsupported video source type.");
                if (source.TryGetProperty("subtitles", out var subs))
                {
                    Require(subs.ValueKind == JsonValueKind.Array && subs.GetArrayLength() <= 50, "Invalid subtitle list.");
                    foreach (var sub in subs.EnumerateArray()) {
                        Url(sub, "url");
                        Require(Text(sub, "language").Length <= 100, "Invalid subtitle language.");
                        Require(Text(sub, "title", true).Length <= 200, "Invalid subtitle title.");
                        if (sub.TryGetProperty("isDefault", out var flag)) Require(flag.ValueKind is JsonValueKind.True or JsonValueKind.False, "Invalid subtitle default flag.");
                    }
                }
            }
        }
        else
        {
            Require(result.ValueKind == JsonValueKind.Object && result.TryGetProperty("episodeServers", out var servers) &&
                servers.ValueKind == JsonValueKind.Array && servers.GetArrayLength() <= 100, "Invalid settings.");
            foreach (var server in result.GetProperty("episodeServers").EnumerateArray())
                Require(server.ValueKind == JsonValueKind.String && server.GetString()!.Length is > 0 and <= 500, "Invalid server name.");
            Require(result.TryGetProperty("supportsDub", out var dub) && dub.ValueKind is JsonValueKind.True or JsonValueKind.False, "Invalid supportsDub.");
        }

        // Identity belongs to the host, never to a script-supplied result.
        var node = JsonNode.Parse(result.GetRawText())!;
        if (method == "findEpisodes") foreach (var episode in node.AsArray()) episode!["provider"] = id;
        if (method == "findEpisodeServer") node["provider"] = id;
        return JsonSerializer.SerializeToElement(node);
    }

    public static void ValidateHeaders(JsonElement headers)
    {
        Require(headers.ValueKind == JsonValueKind.Object && headers.EnumerateObject().Count() <= 32, "Invalid headers.");
        foreach (var header in headers.EnumerateObject())
            Require(header.Name.Length is > 0 and <= 100 && header.Name.All(c => char.IsAsciiLetterOrDigit(c) || "!#$%&'*+-.^_`|~".Contains(c)) &&
                header.Value.ValueKind == JsonValueKind.String && header.Value.GetString()!.Length <= 4096 &&
                !header.Value.GetString()!.Any(c => c is '\r' or '\n' or '\0'), "Invalid header.");
    }

    internal static string Text(JsonElement item, string field, bool optional = false)
    {
        Require(item.ValueKind == JsonValueKind.Object, "Expected result object.");
        if (optional && !item.TryGetProperty(field, out _)) return "";
        Require(item.TryGetProperty(field, out var v) && v.ValueKind == JsonValueKind.String && v.GetString()!.Length <= 4096 && (optional || v.GetString()!.Length > 0), $"Invalid {field}.");
        return item.GetProperty(field).GetString()!;
    }

    internal static void Url(JsonElement item, string field)
    {
        var value = Text(item, field);
        Require(Uri.TryCreate(value, UriKind.Absolute, out var uri) && uri.Scheme == "https" && string.IsNullOrEmpty(uri.UserInfo), $"Invalid HTTPS {field}.");
    }
    internal static void Require(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
    }
}
