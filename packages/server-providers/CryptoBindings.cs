using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jint;

namespace Vestra.Providers;

internal static class CryptoBindings
{
    public static void Bind(Engine engine)
    {
        engine.SetValue("__crypto", new Func<string, string>(Dispatch));
        engine.Execute(Script);
    }
    private static string Dispatch(string json)
    {
        if (json.Length > 2_097_152) throw new ArgumentException("Crypto request too large.");
        using var document = JsonDocument.Parse(json);
        var r = document.RootElement;
        var op = r.GetProperty("op").GetString();
        if (op == "random")
        {
            var count = r.GetProperty("count").GetInt32();
            if (count < 0 || count > 65536) throw new ArgumentException("Random request exceeds 65536 bytes.");
            return JsonSerializer.Serialize(new { data = Convert.ToBase64String(RandomNumberGenerator.GetBytes(count)) });
        }
        var data = Convert.FromBase64String(r.GetProperty("data").GetString()!);
        if (data.Length > 1_048_576) throw new ArgumentException("Crypto input exceeds 1 MiB.");
        if (op is "SHA256" or "SHA1" or "MD5")
        {
            var hash = op switch { "SHA256" => SHA256.HashData(data), "SHA1" => SHA1.HashData(data), _ => MD5.HashData(data) };
            return JsonSerializer.Serialize(new { data = Convert.ToBase64String(hash) });
        }
        if (op is not ("encrypt" or "decrypt")) throw new ArgumentException("Unsupported crypto operation.");
        var password = Convert.FromBase64String(r.GetProperty("key").GetString()!);
        var key = password.Length is 16 or 24 or 32 ? password : SHA256.HashData(password);
        var explicitIv = r.TryGetProperty("iv", out var ivValue) && ivValue.ValueKind == JsonValueKind.String;
        byte[] iv;
        if (explicitIv) iv = Convert.FromBase64String(ivValue.GetString()!);
        else if (op == "encrypt") iv = RandomNumberGenerator.GetBytes(16);
        else if (data.Length >= 16 && data.AsSpan(0, 8).SequenceEqual("Salted__"u8))
        {
            // OpenSSL/CryptoJS legacy EVP_BytesToKey: MD5 chain, AES-256-CBC.
            var salt = data[8..16]; var material = new List<byte>(); byte[] previous = [];
            while (material.Count < 48) { previous = MD5.HashData([.. previous, .. password, .. salt]); material.AddRange(previous); }
            key = material.Take(32).ToArray(); iv = material.Skip(32).Take(16).ToArray(); data = data[16..];
        }
        else
        {
            if (data.Length < 32) throw new CryptographicException("Missing IV/ciphertext.");
            iv = data[..16]; data = data[16..];
        }
        if (iv.Length != 16) throw new CryptographicException("AES-CBC requires a 16-byte IV.");
        using var aes = Aes.Create(); aes.Key = key;
        byte[] result;
        if (op == "encrypt")
        {
            result = aes.EncryptCbc(data, iv, PaddingMode.PKCS7);
            if (!explicitIv) result = [.. iv, .. result];
        }
        else result = aes.DecryptCbc(data, iv, PaddingMode.PKCS7);
        return JsonSerializer.Serialize(new { data = Convert.ToBase64String(result), iv = Convert.ToBase64String(iv) });
    }
    private const string Script = """
        const __cryptoBytes = v => typeof v==='string' ? Buffer.from(v).toString('base64') : v instanceof __WordArray ? v._data : Buffer.from(v).toString('base64');
        class __WordArray {
          constructor(data,defaultEncoding='base64'){this._data=data;this._defaultEncoding=defaultEncoding;this.sigBytes=Buffer.from(data,'base64').length;}
          toString(encoder){return Buffer.from(this._data,'base64').toString(encoder?encoder._encoding:this._defaultEncoding);}
        }
        const __enc = encoding => Object.freeze({_encoding:encoding,parse:value=>new __WordArray(Buffer.from(String(value),encoding).toString('base64')),stringify:value=>Buffer.from(__cryptoBytes(value),'base64').toString(encoding)});
        const __aes=(op,data,key,cfg)=>{
          if(cfg?.mode && cfg.mode!=='CBC')throw new Error('Only AES-CBC is supported');
          if(cfg?.padding && cfg.padding!=='Pkcs7')throw new Error('Only PKCS7 is supported');
          const r=JSON.parse(__crypto(JSON.stringify({op,data:op==='decrypt'&&typeof data==='string'?data:__cryptoBytes(data),key:__cryptoBytes(key),...(cfg?.iv!==undefined?{iv:__cryptoBytes(cfg.iv)}:{})})));
          const out=new __WordArray(r.data);out.iv=Buffer.from(r.iv,'base64');out.ciphertext=out;return out;
        };
        const CryptoJS=Object.freeze({
          enc:Object.freeze({Utf8:__enc('utf8'),Base64:__enc('base64'),Hex:__enc('hex'),Latin1:__enc('latin1'),Utf16:__enc('utf16be'),Utf16LE:__enc('utf16le')}),
          mode:Object.freeze({CBC:'CBC'}),pad:Object.freeze({Pkcs7:'Pkcs7'}),
          AES:Object.freeze({encrypt:(data,key,cfg)=>__aes('encrypt',data,key,cfg),decrypt:(data,key,cfg)=>__aes('decrypt',data,key,cfg)}),
          SHA256:value=>new __WordArray(JSON.parse(__crypto(JSON.stringify({op:'SHA256',data:__cryptoBytes(value)}))).data,'hex'),
          SHA1:value=>new __WordArray(JSON.parse(__crypto(JSON.stringify({op:'SHA1',data:__cryptoBytes(value)}))).data,'hex'),
          MD5:value=>new __WordArray(JSON.parse(__crypto(JSON.stringify({op:'MD5',data:__cryptoBytes(value)}))).data,'hex')
        });
        const crypto=Object.freeze({getRandomValues(array){
          if(!(array instanceof Uint8Array))throw new TypeError('Only Uint8Array is supported');
          const data=Buffer.from(JSON.parse(__crypto(JSON.stringify({op:'random',count:array.length}))).data,'base64');array.set(data);return array;
        }});
        """;
}
