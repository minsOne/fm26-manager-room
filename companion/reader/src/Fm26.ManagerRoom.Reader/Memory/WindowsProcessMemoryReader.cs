using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Fm26.ManagerRoom.Reader.Memory;

internal sealed class WindowsProcessMemoryReader : IProcessMemoryReader
{
    private const uint ProcessVmRead = 0x0010;
    private const uint ProcessQueryInformation = 0x0400;

    private readonly SafeProcessHandle _handle;

    public int ProcessId { get; }

    public WindowsProcessMemoryReader(int processId)
    {
        ProcessId = processId;
        _handle = NativeMethods.OpenProcess(ProcessQueryInformation | ProcessVmRead, false, processId);

        if (_handle.IsInvalid)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), $"OpenProcess failed for PID {processId}.");
        }
    }

    public byte[] ReadBytes(long address, int length)
    {
        if (address <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(address));
        }

        if (length <= 0 || length > 16 * 1024 * 1024)
        {
            throw new ArgumentOutOfRangeException(nameof(length));
        }

        var buffer = new byte[length];

        if (!NativeMethods.ReadProcessMemory(
                _handle,
                new IntPtr(address),
                buffer,
                (nuint)length,
                out var bytesRead))
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                $"ReadProcessMemory failed at 0x{address:X} for {length} bytes.");
        }

        if (bytesRead != (nuint)length)
        {
            throw new IOException(
                $"Partial ReadProcessMemory at 0x{address:X}: expected {length}, read {bytesRead}.");
        }

        return buffer;
    }

    public bool TryReadBytes(long address, int length, out byte[] bytes, out string? error)
    {
        try
        {
            bytes = ReadBytes(address, length);
            error = null;
            return true;
        }
        catch (Exception exception) when (
            exception is Win32Exception
            or IOException
            or ArgumentOutOfRangeException)
        {
            bytes = [];
            error = exception.Message;
            return false;
        }
    }

    public void Dispose()
    {
        _handle.Dispose();
    }

    private static partial class NativeMethods
    {
        [LibraryImport("kernel32.dll", SetLastError = true)]
        internal static partial SafeProcessHandle OpenProcess(
            uint desiredAccess,
            [MarshalAs(UnmanagedType.Bool)] bool inheritHandle,
            int processId);

        [LibraryImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static partial bool ReadProcessMemory(
            SafeProcessHandle process,
            IntPtr baseAddress,
            [Out] byte[] buffer,
            nuint size,
            out nuint bytesRead);
    }
}
