namespace Fm26.ManagerRoom.Reader.Memory;

internal interface IProcessMemoryReader : IDisposable
{
    int ProcessId { get; }

    byte[] ReadBytes(long address, int length);

    bool TryReadBytes(long address, int length, out byte[] bytes, out string? error);
}
