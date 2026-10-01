using System.Diagnostics;
using Fm26.ManagerRoom.Reader.Memory;

namespace Fm26.ManagerRoom.Reader.Runtime;

internal sealed class RuntimeProbe
{
    private const int ProbeBytes = 64;

    public RuntimeProbeResult Probe(Process process)
    {
        var executable = ModuleFingerprint.FromMainModule(process);
        var gameAssembly = ModuleFingerprint.Find(process, "GameAssembly.dll");
        var gamePlugin = ModuleFingerprint.Find(process, "game_plugin.dll");

        var memoryRead = ProbeGamePluginMemory(process.Id, gamePlugin);
        var policy = RuntimeAccessPolicy.Evaluate(executable, gamePlugin, memoryRead);

        return new RuntimeProbeResult(
            ProcessId: process.Id,
            ProcessName: process.ProcessName,
            Executable: executable,
            GameAssembly: gameAssembly,
            GamePlugin: gamePlugin,
            MemoryRead: memoryRead,
            Policy: policy,
            ObservedAtUtc: DateTimeOffset.UtcNow);
    }

    private static MemoryReadProbe ProbeGamePluginMemory(int processId, RuntimeModule? gamePlugin)
    {
        if (gamePlugin is null)
        {
            return MemoryReadProbe.NotAttempted("game_plugin.dll was not found.");
        }

        try
        {
            using var reader = ProcessMemoryReaderFactory.Open(processId);

            if (!reader.TryReadBytes(gamePlugin.BaseAddress, ProbeBytes, out var bytes, out var error))
            {
                return new(false, ProbeBytes, 0, false, null, error);
            }

            var prefix = Convert.ToHexString(bytes.AsSpan(0, Math.Min(16, bytes.Length))).ToLowerInvariant();
            var looksLikePe = bytes.Length >= 2 && bytes[0] == 0x4D && bytes[1] == 0x5A;

            return new(
                Success: true,
                BytesRequested: ProbeBytes,
                BytesRead: bytes.Length,
                LooksLikePortableExecutable: looksLikePe,
                PrefixHex: prefix,
                Error: null);
        }
        catch (Exception exception)
        {
            return new(false, ProbeBytes, 0, false, null, exception.Message);
        }
    }
}

internal sealed record RuntimeProbeResult(
    int ProcessId,
    string ProcessName,
    RuntimeModule? Executable,
    RuntimeModule? GameAssembly,
    RuntimeModule? GamePlugin,
    MemoryReadProbe MemoryRead,
    RuntimeAccessPolicy Policy,
    DateTimeOffset ObservedAtUtc);
