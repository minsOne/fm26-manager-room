using System.Diagnostics;
using System.Security.Cryptography;

namespace Fm26.ManagerRoom.Reader.Runtime;

internal static class ModuleFingerprint
{
    public static RuntimeModule? Find(Process process, string moduleName)
    {
        try
        {
            foreach (ProcessModule module in process.Modules)
            {
                if (!string.Equals(module.ModuleName, moduleName, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                return Build(module);
            }
        }
        catch
        {
            return null;
        }

        return null;
    }

    public static RuntimeModule? Main(Process process)
    {
        try
        {
            return process.MainModule is null ? null : Build(process.MainModule);
        }
        catch
        {
            return null;
        }
    }

    private static RuntimeModule Build(ProcessModule module)
    {
        var path = module.FileName;
        var version = TryVersion(path);
        var sha256 = TrySha256(path);

        return new RuntimeModule(
            module.ModuleName,
            path,
            module.BaseAddress.ToInt64(),
            module.ModuleMemorySize,
            version.FileVersion,
            version.ProductVersion,
            sha256);
    }

    private static (string? FileVersion, string? ProductVersion) TryVersion(string path)
    {
        try
        {
            var info = FileVersionInfo.GetVersionInfo(path);
            return (info.FileVersion, info.ProductVersion);
        }
        catch
        {
            return (null, null);
        }
    }

    private static string? TrySha256(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        }
        catch
        {
            return null;
        }
    }
}

internal sealed record RuntimeModule(
    string Name,
    string Path,
    long BaseAddress,
    int Size,
    string? FileVersion,
    string? ProductVersion,
    string? Sha256);
