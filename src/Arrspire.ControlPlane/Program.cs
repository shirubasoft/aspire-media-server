using System.CommandLine;
using Arrspire.ControlPlane;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

try
{
    var root = ControlPlaneCommands.CreateRootCommand();
    Environment.ExitCode = await root.Parse(args).InvokeAsync();
}
catch (Exception exception)
{
    Console.Error.WriteLine($"Control plane failed: {exception.Message}");
    Environment.ExitCode = 1;
}
