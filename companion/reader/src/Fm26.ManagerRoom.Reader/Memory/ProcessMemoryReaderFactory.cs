namespace Fm26.ManagerRoom.Reader.Memory;

internal static class ProcessMemoryReaderFactory
{
    public static IProcessMemoryReader Open(int processId)
    {
        if (OperatingSystem.IsWindows())
        {
            return new WindowsProcessMemoryReader(processId);
        }

        throw new PlatformNotSupportedException("FM26 runtime memory reading is currently implemented for Windows only.");
    }
}
