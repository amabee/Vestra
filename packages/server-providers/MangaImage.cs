namespace Vestra.Providers;

public static class MangaImage
{
    public static object Encode(BinaryFetchResponse response)
    {
        if(response.Status is <200 or >=300)throw new InvalidOperationException($"Page image HTTP {response.Status}.");
        if(response.Body.Length is 0 or >2097152)throw new InvalidOperationException("Page image must be 1 byte to 2 MiB.");
        var mime=response.Headers.GetValueOrDefault("Content-Type")?.Split(';')[0].Trim().ToLowerInvariant();
        // Some source CDNs deliver real raster bytes as generic binary data.
        // Sniff only known raster signatures; never accept HTML or SVG here.
        if(mime is null or "" or "application/octet-stream" or "binary/octet-stream")
            mime=RasterMime(response.Body);
        if(mime is not ("image/jpeg" or "image/png" or "image/webp" or "image/gif" or "image/avif"))
            throw new InvalidOperationException("Page is not a supported raster image.");
        return new {mimeType=mime,data=Convert.ToBase64String(response.Body)};
    }

    private static string? RasterMime(ReadOnlySpan<byte> bytes)
    {
        if(bytes.Length>=3 && bytes[0]==0xff && bytes[1]==0xd8 && bytes[2]==0xff)return "image/jpeg";
        if(bytes.StartsWith(new byte[]{137,80,78,71,13,10,26,10}))return "image/png";
        if(bytes.StartsWith("GIF87a"u8)||bytes.StartsWith("GIF89a"u8))return "image/gif";
        if(bytes.Length>=12 && bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8,4).SequenceEqual("WEBP"u8))return "image/webp";
        if(bytes.Length>=12 && bytes.Slice(4,4).SequenceEqual("ftyp"u8) &&
            (bytes.Slice(8,4).SequenceEqual("avif"u8)||bytes.Slice(8,4).SequenceEqual("avis"u8)))return "image/avif";
        return null;
    }
}
