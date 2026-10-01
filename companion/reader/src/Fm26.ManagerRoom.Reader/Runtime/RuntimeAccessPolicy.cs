namespace Fm26.ManagerRoom.Reader.Runtime;

internal enum RuntimeAccessMode
{
    Unsupported,
    ReadOnly,
    VerifiedWrite
}

internal sealed record RuntimeAccessPolicy(
    RuntimeAccessMode Mode,
    string Reason,
    string? ProfileId)
{
    public static RuntimeAccessPolicy Evaluate(RuntimeModule? executable, RuntimeModule? gamePlugin)
    {
        if (executable is null)
        {
            return new(RuntimeAccessMode.Unsupported, "FM executable metadata could not be read.", null);
        }

        if (gamePlugin is null)
        {
            return new(RuntimeAccessMode.Unsupported, "game_plugin.dll is not loaded. Load a save and retry.", null);
        }

        var profile = VerifiedRuntimeProfiles.Find(executable, gamePlugin);
        if (profile is not null)
        {
            return new(RuntimeAccessMode.VerifiedWrite, "Runtime build matches a verified profile.", profile.Id);
        }

        return new(
            RuntimeAccessMode.ReadOnly,
            "Unknown FM26 build fingerprint. Read-only probing is allowed; writes are blocked.",
            null);
    }
}
