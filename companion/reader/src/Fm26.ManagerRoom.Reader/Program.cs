using System.Text.Json;
using Fm26.ManagerRoom.Reader.Runtime;

var options = ReaderOptions.Parse(args);
if (!options.IsValid)
{
    Console.Error.WriteLine("Usage: fm26-reader probe [--process <name>] [--pretty]");
    return 2;
}

if (!OperatingSystem.IsWindows())
{
    Console.Error.WriteLine("Runtime probing is currently implemented for Windows only.");
    return 3;
}

var locator = new FmProcessLocator();
var process = locator.FindBestMatch(options.ProcessName);

if (process is null)
{
    Console.Error.WriteLine("FM26 process not found. Start FM26 and load a save, then try again.");
    return 4;
}

using (process)
{
    var probe = new RuntimeProbe();
    var result = probe.Probe(process);

    var json = JsonSerializer.Serialize(
        result,
        new JsonSerializerOptions { WriteIndented = options.Pretty });

    Console.WriteLine(json);
    return result.Policy.Mode == RuntimeAccessMode.Unsupported ? 5 : 0;
}

internal sealed record ReaderOptions(string Command, string ProcessName, bool Pretty, bool IsValid)
{
    public static ReaderOptions Parse(string[] args)
    {
        if (args.Length == 0 || !string.Equals(args[0], "probe", StringComparison.OrdinalIgnoreCase))
        {
            return new("", "fm", true, false);
        }

        var process = "fm";
        var pretty = false;

        for (var index = 1; index < args.Length; index++)
        {
            switch (args[index])
            {
                case "--pretty":
                    pretty = true;
                    break;
                case "--process" when index + 1 < args.Length:
                    process = args[++index];
                    break;
                default:
                    return new(args[0], process, pretty, false);
            }
        }

        return new(args[0], process, pretty, true);
    }
}
