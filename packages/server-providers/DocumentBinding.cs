using AngleSharp.Dom;
using AngleSharp.Html.Parser;
using System.Text.Json;
using Jint;

namespace Vestra.Providers;

/// <summary>Read-only DOM selections behind numeric handles, never CLR DOM objects.</summary>
internal sealed class DocumentBinding : IDisposable
{
    private readonly Dictionary<int, INode[]> selections = [];
    private readonly List<IDocument> documents = [];
    private int htmlBudget;
    private int nodeBudget;
    private readonly CancellationToken ct;
    public DocumentBinding(CancellationToken ct) => this.ct = ct;
    private int Save(IEnumerable<INode> nodes)
    {
        var rows = nodes.Distinct().Take(20_001).ToArray();
        nodeBudget += rows.Length;
        if (selections.Count >= 4096 || nodeBudget > 100_000 || rows.Length > 20_000)
            throw new InvalidOperationException("DOM selection budget exceeded.");
        var id = selections.Count + 1;
        selections.Add(id, rows);
        return id;
    }
    public void Bind(Engine engine)
    {
        engine.SetValue("__dom", new Func<string, string>(Dispatch));
        engine.Execute(Bootstrap);
    }
    private string Dispatch(string json)
    {
        ct.ThrowIfCancellationRequested();
        using var request = JsonDocument.Parse(json);
        var r = request.RootElement;
        var op = r.GetProperty("op").GetString();
        var arg = r.TryGetProperty("arg", out var a) ? a.GetString() ?? "" : "";
        object? result;
        if (op == "parse")
        {
            htmlBudget += arg.Length;
            if (htmlBudget > 4_194_304 || documents.Count >= 16) throw new InvalidOperationException("DOM HTML budget exceeded.");
            var doc = new HtmlParser().ParseDocument(arg);
            documents.Add(doc);
            result = Save([doc]);
        }
        else
        {
            if (!selections.TryGetValue(r.GetProperty("id").GetInt32(), out var nodes)) throw new ArgumentException("Unknown DOM selection.");
            if (arg.Length > 4096) throw new ArgumentException("DOM argument too long.");
            var elements = nodes.OfType<IElement>();
            result = op switch
            {
                "find" => Save(nodes.OfType<IParentNode>().SelectMany(n => n.QuerySelectorAll(arg))),
                "length" => nodes.Length,
                "text" => string.Concat(nodes.Select(n => n.TextContent)),
                "html" => elements.FirstOrDefault()?.InnerHtml ?? "",
                "attr" => elements.FirstOrDefault()?.GetAttribute(arg),
                "attrs" => elements.FirstOrDefault()?.Attributes.ToDictionary(a => a.Name, a => a.Value) ?? [],
                "eq" => Save(nodes.Skip(NormalizeIndex(int.Parse(arg), nodes.Length)).Take(NormalizeIndex(int.Parse(arg), nodes.Length) >= 0 ? 1 : 0)),
                "children" => Save(nodes.OfType<IParentNode>().SelectMany(n => n.Children).Where(n => arg == "" || n.Matches(arg))),
                "parent" => Save(nodes.Select(n => n.ParentElement).OfType<IElement>()),
                "filter" => Save(elements.Where(n => n.Matches(arg))),
                "not" => Save(elements.Where(n => !n.Matches(arg))),
                "is" => elements.Any(n => n.Matches(arg)),
                "has" => Save(elements.Where(n => n.QuerySelector(arg) is not null)),
                _ => throw new NotSupportedException($"Unsupported DOM operation {op}.")
            };
        }
        ct.ThrowIfCancellationRequested();
        return JsonSerializer.Serialize(result);
    }
    private static int NormalizeIndex(int index, int length) => index < 0 ? length + index : index;
    public void Dispose() { foreach (var doc in documents) doc.Dispose(); selections.Clear(); }
    private const string Bootstrap = """
        class DocSelection {
          constructor(id) { this.__id = id; }
          __call(op, arg = '') { return JSON.parse(__dom(JSON.stringify({op, id:this.__id, arg:String(arg)}))); }
          __select(op, arg = '') { return new DocSelection(this.__call(op,arg)); }
          length() { return this.__call('length'); }
          find(s) { return this.__select('find',s); }
          text() { return this.__call('text'); }
          html() { return this.__call('html'); }
          attr(name) { return this.__call('attr',name) ?? undefined; }
          attrs() { return this.__call('attrs'); }
          data(name) { return this.attr('data-'+name); }
          eq(i) { return this.__select('eq',i); }
          first() { return this.eq(0); }
          last() { return this.eq(-1); }
          children(s='') { return this.__select('children',s); }
          parent() { return this.__select('parent'); }
          filter(s) { return this.__select('filter',s); }
          not(s) { return this.__select('not',s); }
          has(s) { return this.__select('has',s); }
          is(s) { return this.__call('is',s); }
          each(fn) { for(let i=0,n=this.length();i<n;i++) fn(i,this.eq(i)); }
          map(fn) { const out=[]; for(let i=0,n=this.length();i<n;i++) out.push(fn(i,this.eq(i))); return out; }
        }
        class Doc extends DocSelection {
          constructor(html) { super(JSON.parse(__dom(JSON.stringify({op:'parse',arg:String(html)})))); }
        }
        function LoadDoc(html) { const doc=new Doc(html); return selector => selector instanceof DocSelection ? selector : doc.find(selector); }
        """;
}
