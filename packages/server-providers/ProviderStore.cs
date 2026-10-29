using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jint;

namespace Vestra.Providers;

public sealed class ProviderStore(string? directory = null)
{
    private readonly Dictionary<string, Dictionary<string, JsonElement>> cache = [];
    private readonly object gate = new();
    public void Bind(Engine engine, string id)
    {
        engine.SetValue("__store", new Func<string, string>(json => Dispatch(id, json)));
        engine.Execute("""
          const $store=Object.freeze({
            get(key){const r=JSON.parse(__store(JSON.stringify({op:'get',key:String(key)})));return r.found?r.value:undefined;},
            set(key,value){if(value===undefined)throw new TypeError('Cannot store undefined');__store(JSON.stringify({op:'set',key:String(key),value}));},
            delete(key){return JSON.parse(__store(JSON.stringify({op:'delete',key:String(key)})));},
            clear(){__store(JSON.stringify({op:'clear'}));},
            length(){return JSON.parse(__store(JSON.stringify({op:'length'})));}
          });
          """);
    }
    private string Dispatch(string id, string json)
    {
        if (Encoding.UTF8.GetByteCount(json) > 262144) throw new ArgumentException("Store operation exceeds 256 KiB.");
        lock (gate)
        {
            var file = directory is null ? null : Path.Combine(Path.GetFullPath(directory), Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(id))) + ".json");
            if (!cache.TryGetValue(id, out var current))
            {
                if (file is not null && File.Exists(file))
                {
                    if (new FileInfo(file).Length > 1048576) throw new InvalidDataException("Provider store exceeds 1 MiB.");
                    current = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(File.ReadAllText(file)) ?? throw new InvalidDataException("Invalid provider store.");
                }
                else current = [];
                cache[id] = current;
            }
            using var request = JsonDocument.Parse(json);
            var r = request.RootElement;
            var op = r.GetProperty("op").GetString();
            var key = r.TryGetProperty("key", out var k) ? k.GetString()! : "";
            if (key.Length > 512) throw new ArgumentException("Store key exceeds 512 characters.");
            if (op == "get") return JsonSerializer.Serialize(new { found = current.ContainsKey(key), value = current.GetValueOrDefault(key, JsonSerializer.SerializeToElement<object?>(null)) });
            if (op == "length") return current.Count.ToString();
            var next = new Dictionary<string, JsonElement>(current);
            bool deleted = false;
            switch (op)
            {
                case "set": next[key] = r.GetProperty("value").Clone(); break;
                case "delete": deleted = next.Remove(key); break;
                case "clear": next.Clear(); break;
                default: throw new ArgumentException("Unknown store operation.");
            }
            var bytes = JsonSerializer.SerializeToUtf8Bytes(next);
            if (next.Count > 256 || bytes.Length > 1048576) throw new InvalidOperationException("Provider store quota exceeded.");
            if (file is not null)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(file)!);
                var temp = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
                try
                {
                    using (var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { output.Write(bytes); output.Flush(true); }
                    File.Move(temp, file, true);
                }
                finally { if (File.Exists(temp)) File.Delete(temp); }
            }
            cache[id] = next;
            return JsonSerializer.Serialize(deleted);
        }
    }
}
