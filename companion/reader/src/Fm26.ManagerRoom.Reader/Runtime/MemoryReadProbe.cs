namespace Fm26.ManagerRoom.Reader.Runtime;

internal sealed record MemoryReadProbe(
    bool Success,
    int BytesRequested,
    int BytesRead,
    bool LooksLikePortableExecutable,
    string? PrefixHex,
    string? Error)
{
    public static MemoryReadProbe NotAttempted(string reason)
        => new(false, 0, 0, false, null, reason);
}
