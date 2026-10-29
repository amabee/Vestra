using System.Text;
using System.Text.Json;
using Jint;

namespace Vestra.Providers;

internal static class FormBindings
{
    public static void Bind(Engine engine)
    {
        engine.SetValue("__encodeForm", new Func<string,string>(json =>
        {
            if(Encoding.UTF8.GetByteCount(json)>65536)throw new ArgumentException("Form exceeds 64 KiB.");
            var pairs=JsonSerializer.Deserialize<string[][]>(json)!;
            if(pairs.Length>256)throw new ArgumentException("Form exceeds 256 fields.");
            using var content=new MultipartFormDataContent();
            foreach(var pair in pairs)
            {
                if(pair.Length!=2 || pair[0].Length>512 || pair[0].Any(c=>c is '\r' or '\n' or '\0'))throw new ArgumentException("Invalid form field.");
                content.Add(new StringContent(pair[1],Encoding.UTF8),pair[0]);
            }
            var body=content.ReadAsStringAsync().GetAwaiter().GetResult();
            return JsonSerializer.Serialize(new {body,contentType=content.Headers.ContentType!.ToString()});
        }));
        engine.Execute(Script);
    }
    private const string Script="""
      class Headers {
        constructor(init={}) {
          this._values=new Map();
          if(init instanceof Headers)init=init.entries();
          if(init && typeof init[Symbol.iterator]==='function')for(const pair of init){if(pair.length!==2)throw new TypeError('Invalid header pair');this.append(pair[0],pair[1]);}
          else if(init)for(const k of Object.keys(init))this.append(k,init[k]);
        }
        _key(k){k=String(k).toLowerCase();if(!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(k))throw new TypeError('Invalid header name');return k;}
        _value(v){v=String(v).trim();if(/[\r\n\0]/.test(v))throw new TypeError('Invalid header value');return v;}
        append(k,v){k=this._key(k);v=this._value(v);this._values.set(k,this._values.has(k)?this._values.get(k)+', '+v:v);}
        set(k,v){this._values.set(this._key(k),this._value(v));}
        get(k){return this._values.get(this._key(k))??null;}
        has(k){return this._values.has(this._key(k));}
        delete(k){this._values.delete(this._key(k));}
        *entries(){yield* [...this._values].sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);}
        *keys(){for(const [k] of this.entries())yield k;}
        *values(){for(const [,v] of this.entries())yield v;}
        [Symbol.iterator](){return this.entries();}
        forEach(fn,thisArg){for(const [k,v] of this.entries())fn.call(thisArg,v,k,this);}
      }
      class FormData {
        constructor(){this._pairs=[];this._cached=null;}
        append(k,v){if(arguments.length>2 || typeof v!=='string')throw new TypeError('Only text form fields are supported');this._pairs.push([String(k),v]);this._cached=null;}
        set(k,v){k=String(k);v=String(v);const at=this._pairs.findIndex(p=>p[0]===k);this._pairs=this._pairs.filter(p=>p[0]!==k);this._pairs.splice(at<0?this._pairs.length:at,0,[k,v]);this._cached=null;}
        get(k){return this._pairs.find(p=>p[0]===String(k))?.[1]??null;}
        getAll(k){return this._pairs.filter(p=>p[0]===String(k)).map(p=>p[1]);}
        has(k){return this._pairs.some(p=>p[0]===String(k));}
        delete(k){this._pairs=this._pairs.filter(p=>p[0]!==String(k));this._cached=null;}
        entries(){return this._pairs.map(p=>p.slice());}
        keys(){return this._pairs.map(p=>p[0]);}
        values(){return this._pairs.map(p=>p[1]);}
        [Symbol.iterator](){return this.entries()[Symbol.iterator]();}
        _encode(){return this._cached??(this._cached=JSON.parse(__encodeForm(JSON.stringify(this._pairs))));}
        getContentType(){return this._encode().contentType;}
        getBuffer(){return Buffer.from(this._encode().body);}
      }
      """;
}
