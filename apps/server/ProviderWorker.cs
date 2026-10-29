using System.Text;
using System.Text.Json;
using Vestra.Providers;

namespace Vestra.Server;

/// <summary>Private stdin/stdout protocol; no network listener or renderer entry point.</summary>
internal static class ProviderWorker
{
    public static async Task RunAsync()
    {
        using var transport = new ProviderHttpTransport();
        var runtime = new ProviderRuntime(transport, store: new ProviderStore(Environment.GetEnvironmentVariable("VESTRA_PROVIDER_DATA_DIR")));
        var progress = new ReadingProgressStore(Environment.GetEnvironmentVariable("VESTRA_PROVIDER_DATA_DIR"));
        using var input = Console.OpenStandardInput();
        using var output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false)) { AutoFlush = true };
        await output.WriteLineAsync("{\"kind\":\"ready\",\"protocol\":1,\"engine\":\"jint\",\"compatibility\":\"seanime-onlinestream-subset\"}");
        // Byte-bounded lines: StreamReader.ReadLine would allocate unbounded input.
        using var line = new MemoryStream();
        var buffer = new byte[8192];
        int read;
        while ((read = await input.ReadAsync(buffer)) > 0)
        {
            for (var offset = 0; offset < read; offset++)
            {
                var value = buffer[offset];
                if (value != '\n')
                {
                    if (line.Length >= 2_097_152) throw new InvalidDataException("Worker request exceeds 2 MiB.");
                    line.WriteByte(value);
                    continue;
                }
                if (line.Length == 0) continue;
                string? id = null;
                try
                {
                    using var document = JsonDocument.Parse(line.ToArray());
                    var command = document.RootElement;
                    id = command.GetProperty("id").GetString();
                    object? result = command.GetProperty("kind").GetString() switch
                    {
                        "load" => await runtime.LoadAsync(command.GetProperty("provider").Deserialize<ProviderDefinition>(ProviderRuntime.JsonOptions)!),
                        "call" => await runtime.CallAsync(command.GetProperty("providerId").GetString()!, command.GetProperty("method").GetString()!,
                            command.GetProperty("args").Deserialize<JsonElement[]>()!),
                        "unload" => runtime.Unload(command.GetProperty("providerId").GetString()!),
                        "list" => runtime.List(),
                        "capabilities" => ProviderCapabilities.Describe(),
                        "image" => await ImageAsync(transport,command),
                        "progress:get" => progress.Read(command.GetProperty("providerId").GetString()!, command.GetProperty("bookId").GetString()!),
                        "progress:recent" => progress.Recent(command.GetProperty("providerId").GetString()!),
                        "progress:save" => progress.Save(command.GetProperty("providerId").GetString()!, command.GetProperty("bookId").GetString()!,
                            command.GetProperty("chapterId").GetString()!, command.GetProperty("page").GetInt32(), command.GetProperty("pageCount").GetInt32(),
                            command.TryGetProperty("title", out var title) ? title.GetString() : null),
                        "progress:import" => progress.Import(command.GetProperty("providerId").GetString()!, command.GetProperty("bookId").GetString()!,
                            command.GetProperty("progress").Deserialize<ReadingPosition>(ProviderRuntime.JsonOptions) ?? throw new ArgumentException("Missing reading position.")),
                        _ => throw new ArgumentException("Unknown worker command.")
                    };
                    await output.WriteLineAsync(JsonSerializer.Serialize(new { id, ok = true, value = result }, ProviderRuntime.JsonOptions));
                }
                catch (Exception error)
                {
                    var message = error.Message;
                    await output.WriteLineAsync(JsonSerializer.Serialize(new { id, ok = false, error = message[..Math.Min(message.Length, 2000)] }, ProviderRuntime.JsonOptions));
                }
                finally { line.SetLength(0); }
            }
        }
    }
    private static async Task<object> ImageAsync(ProviderHttpTransport transport,JsonElement command)
    {
        var request=command.GetProperty("request").Deserialize<FetchRequest>(ProviderRuntime.JsonOptions)!;
        if(request.Method!="GET"||request.Body is not null)throw new ArgumentException("Images require GET without a body.");
        using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var uri=new Uri(request.Url,UriKind.Absolute);
        return MangaImage.Encode(await transport.FetchBinaryAsync(request,new HashSet<string>(StringComparer.OrdinalIgnoreCase){uri.IdnHost},deadline.Token));
    }
}
