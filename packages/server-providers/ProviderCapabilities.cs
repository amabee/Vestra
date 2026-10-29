namespace Vestra.Providers;

public static class ProviderCapabilities
{
    public static object Describe() => new
    {
        protocol = 1,
        engine = "Jint",
        gojaEnginePort = false,
        fullSeanimeCompatibility = false,
        extensionTypes = new[] { "onlinestream-provider", "manga-provider" },
        responseSemantics = "seanime-synchronous-body-methods",
        bindings = new[] { "fetch-text", "Headers", "FormData-text", "Doc-readonly-subset", "LoadDoc", "Buffer-subset", "URL-http-subset", "URLSearchParams-subset", "CryptoJS-subset", "crypto-Uint8Array-random", "$getUserPreference", "$store-json" },
        unsupported = new[] { "plugins-and-hooks", "manga-bulk-downloads", "manga-search-ranking", "torrent-contract", "custom-source-contract", "ChromeDP", "scanner-utils", "torrent-utils", "timers", "per-fetch-AbortSignal", "binary-uploads", "complete-Node-API", "complete-goquery-API" }
    };
}
