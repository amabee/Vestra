using System.Net;
using System.Text;
using System.Text.Json;
using Jint;

namespace Vestra.Providers;

internal static class BinaryUrlBindings
{
    private const int MaxBytes = 1_048_576;
    public static void Bind(Engine engine)
    {
        engine.SetValue("__bufferEncode", new Func<string, string, string>((input, encoding) =>
        {
            Check(input);
            byte[] bytes = encoding.ToLowerInvariant() switch
            {
                "utf8" or "utf-8" => Encoding.UTF8.GetBytes(input),
                "utf16le" => Encoding.Unicode.GetBytes(input),
                "utf16be" => Encoding.BigEndianUnicode.GetBytes(input),
                "latin1" or "binary" => input.Select(c => (byte)c).ToArray(),
                "hex" => Convert.FromHexString(input),
                "base64" or "base64url" => DecodeBase64(input),
                _ => throw new NotSupportedException("Unsupported Buffer encoding.")
            };
            if (bytes.Length > MaxBytes) throw new ArgumentException("Buffer exceeds 1 MiB.");
            return Convert.ToBase64String(bytes);
        }));
        engine.SetValue("__bufferDecode", new Func<string, string, string>((input, encoding) =>
        {
            Check(input);
            var bytes = DecodeBase64(input);
            if (bytes.Length > MaxBytes) throw new ArgumentException("Buffer exceeds 1 MiB.");
            return encoding.ToLowerInvariant() switch
            {
                "utf8" or "utf-8" => Encoding.UTF8.GetString(bytes),
                "utf16le" => Encoding.Unicode.GetString(bytes),
                "utf16be" => Encoding.BigEndianUnicode.GetString(bytes),
                "latin1" or "binary" => Encoding.Latin1.GetString(bytes),
                "hex" => Convert.ToHexString(bytes).ToLowerInvariant(),
                "base64" => Convert.ToBase64String(bytes),
                "base64url" => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_'),
                _ => throw new NotSupportedException("Unsupported Buffer encoding.")
            };
        }));
        engine.SetValue("__formDecode", new Func<string, string>(s => { Check(s); return WebUtility.UrlDecode(s); }));
        engine.SetValue("__parseUrl", new Func<string, string, string>((input, baseUrl) =>
        {
            if (input.Length > 8192 || baseUrl.Length > 8192) throw new ArgumentException("URL exceeds 8192 characters.");
            var uri = baseUrl == "" ? new Uri(input, UriKind.Absolute) : new Uri(new Uri(baseUrl, UriKind.Absolute), input);
            if (uri.Scheme is not ("http" or "https")) throw new NotSupportedException("URL supports HTTP(S) only.");
            if (uri.UserInfo != "") throw new NotSupportedException("URL credentials are not supported.");
            uri = new UriBuilder(uri) { Host = uri.IdnHost }.Uri;
            var port = uri.IsDefaultPort ? "" : uri.Port.ToString();
            var hostname = uri.Host;
            var host = hostname + (port == "" ? "" : ":" + port);
            return JsonSerializer.Serialize(new { href = uri.AbsoluteUri, protocol = uri.Scheme + ":", hostname, host,
                port, pathname = uri.AbsolutePath, search = uri.Query, hash = uri.Fragment, origin = uri.Scheme + "://" + host });
        }));
        engine.Execute(Script);
    }
    private static void Check(string s) { if (s.Length > 2 * MaxBytes) throw new ArgumentException("Binary input too large."); }
    private static byte[] DecodeBase64(string s)
    {
        var normalized = string.Concat(s.Where(c => !char.IsWhiteSpace(c))).Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(normalized.PadRight((normalized.Length + 3) / 4 * 4, '='));
    }
    private const string Script = """
        class Buffer extends Uint8Array {
          constructor(value) {
            if (typeof value === 'number' && (!Number.isInteger(value) || value < 0 || value > 1048576)) throw new RangeError('Buffer exceeds 1 MiB');
            if (value != null && typeof value !== 'number' && (!Number.isInteger(value.length) || value.length > 1048576)) throw new TypeError('Expected bounded array-like input');
            super(value);
          }
          static from(value, encoding='utf8') {
            if (typeof value !== 'string') {
              if (typeof value === 'number') throw new TypeError('Buffer.from does not accept a number');
              return new Buffer(value);
            }
            const raw=atob(__bufferEncode(value,String(encoding)));
            const out=new Buffer(raw.length); for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i); return out;
          }
          static alloc(size, fill=0) { const out=new Buffer(size); out.fill(fill); return out; }
          static isBuffer(value) { return value instanceof Buffer; }
          static byteLength(value, encoding='utf8') { return Buffer.from(value,encoding).length; }
          toString(encoding='utf8',start=0,end=this.length) {
            start=Math.max(0,Math.min(this.length,Math.trunc(start)||0));
            end=Math.max(start,Math.min(this.length,Math.trunc(end)||0));
            let raw=''; for(let i=start;i<end;i++) raw+=String.fromCharCode(this[i]);
            return __bufferDecode(btoa(raw),String(encoding));
          }
        }
        const __formEncode = v => encodeURIComponent(String(v)).replace(/[!'()~]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g,'+');
        class URLSearchParams {
          constructor(init='') {
            this._pairs=[];
            if(typeof init==='string') {
              for(const item of init.replace(/^\?/,'').split('&')) {
                if(!item)continue; const i=item.indexOf('=');
                this._pairs.push([__formDecode(i<0?item:item.slice(0,i)),__formDecode(i<0?'':item.slice(i+1))]);
              }
            } else if(init && typeof init[Symbol.iterator]==='function') {
              for(const pair of init) { const row=Array.from(pair); if(row.length!==2)throw new TypeError('Expected key/value pair'); this.append(row[0],row[1]); }
            } else if(init!=null) { for(const key of Object.keys(init)) this.append(key,init[key]); }
          }
          get size(){return this._pairs.length;}
          append(k,v){this._pairs.push([String(k),String(v)]);this._changed?.();}
          get(k){return this._pairs.find(p=>p[0]===String(k))?.[1]??null;}
          getAll(k){return this._pairs.filter(p=>p[0]===String(k)).map(p=>p[1]);}
          has(k,v){return this._pairs.some(p=>p[0]===String(k)&&(arguments.length<2||p[1]===String(v)));}
          set(k,v){k=String(k);v=String(v);const first=this._pairs.findIndex(p=>p[0]===k);if(first<0)this._pairs.push([k,v]);else {this._pairs[first][1]=v;this._pairs=this._pairs.filter((p,i)=>p[0]!==k||i===first);}this._changed?.();}
          delete(k,v){const byValue=arguments.length>1;this._pairs=this._pairs.filter(p=>p[0]!==String(k)||(byValue&&p[1]!==String(v)));this._changed?.();}
          sort(){this._pairs.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);this._changed?.();}
          *entries(){yield* this._pairs.map(p=>p.slice());}
          *keys(){for(const p of this._pairs)yield p[0];}
          *values(){for(const p of this._pairs)yield p[1];}
          [Symbol.iterator](){return this.entries();}
          forEach(fn,thisArg){for(const p of this._pairs)fn.call(thisArg,p[1],p[0],this);}
          toString(){return this._pairs.map(p=>__formEncode(p[0])+'='+__formEncode(p[1])).join('&');}
        }
        class URL {
          constructor(input,base){this._assign(String(input),base===undefined?'':String(base));}
          _assign(input,base='') {
            this._data=JSON.parse(__parseUrl(input,base));
            const params=new URLSearchParams(this._data.search);
            if(this._params)this._params._pairs=params._pairs;else this._params=params;
            this._params._changed=()=>{const q=this._params.toString();this._data.search=q?'?'+q:'';};
          }
          get href(){return this.origin+this.pathname+this.search+this.hash;}
          set href(v){this._assign(String(v));}
          get protocol(){return this._data.protocol;}
          get host(){return this._data.host;}
          get hostname(){return this._data.hostname;}
          get port(){return this._data.port;}
          get origin(){return this._data.origin;}
          get pathname(){return this._data.pathname;}
          get hash(){return this._data.hash;}
          get search(){return this._data.search;}
          set search(v){const text=String(v);this._assign(this.origin+this.pathname+(text?(text.startsWith('?')?text:'?'+text):'')+this.hash);}
          get searchParams(){return this._params;}
          toString(){return this.href;}
          toJSON(){return this.href;}
        }
        """;
}
