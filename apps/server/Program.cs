using System.Net;
using Vestra.Server;

if (args.Contains("--provider-worker"))
{
    await ProviderWorker.RunAsync();
    return;
}

var builder = WebApplication.CreateBuilder(args);

// Desktop sidecar: bind only to loopback and let the OS choose a free port.
// The eventual Electron launcher must read the listening address and own shutdown.
builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseExceptionHandler();
app.MapGet("/api/v1/health", () => new
{
    service = "vestra-server",
    apiVersion = 1,
    status = "ok"
});
app.MapGet("/api/v1/capabilities", () => new
{
    // This host is a migration foundation, not a provider implementation.
    providerExecution = false,
    seanimeProviderCompatibility = false,
    providerWorker = new { available = true, protocol = 1, compatibility = "seanime-onlinestream-subset" },
    libraryScanning = false,
    persistence = false
});
app.Run();
