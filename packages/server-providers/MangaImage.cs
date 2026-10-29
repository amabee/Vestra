namespace Vestra.Providers;

public static class MangaImage
{
    public static object Encode(BinaryFetchResponse response)
    {
        if(response.Status is <200 or >=300)throw new InvalidOperationException($"Page image HTTP {response.Status}.");
        var mime=response.Headers.GetValueOrDefault("Content-Type")?.Split(';')[0].Trim().ToLowerInvariant();
        if(mime is not ("image/jpeg" or "image/png" or "image/webp" or "image/gif" or "image/avif"))
            throw new InvalidOperationException("Page is not a supported raster image.");
        if(response.Body.Length is 0 or >2097152)throw new InvalidOperationException("Page image must be 1 byte to 2 MiB.");
        return new {mimeType=mime,data=Convert.ToBase64String(response.Body)};
    }
}
