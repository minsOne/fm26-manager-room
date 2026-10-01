using System.Diagnostics;

namespace Fm26.ManagerRoom.Reader.Runtime;

internal sealed class RuntimeProbe
{
    public RuntimeProbeResult Probe(Process process)
    {
        var executable = ModuleFingerprint.Main(process);
        var gameAssembly = ModuleFingerprint.Find(process, "GameAssembly.dll");
        var gamePlugin = ModuleFingerprint.Find(process, "game_plugin.dll");

        var policy = RuntimeAccessPolicy.Evaluate(executable, gamePlugin);

        return new RuntimeProbeResult(
            ProcessId: process.Id,
            ProcessName: process.ProcessName,
            Executable: executable,
            GameAssembly: gameAssembly,
            GamePlugin: gamePlugin,
            Policy: policy,
            ObservedAtUtc: DateTimeOffset.UtcNow);
    }
}

internal sealed record RuntimeProbeResult(
    int ProcessId,
    string ProcessName,
    RuntimeModule? Executable,
    RuntimeModule? GameAssembly,
    RuntimeModule? GamePlugin,
    RuntimeAccessPolicy Policy,
    DateTimeOffset ObservedAtUtc);
