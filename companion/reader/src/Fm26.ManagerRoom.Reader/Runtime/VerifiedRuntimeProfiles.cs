namespace Fm26.ManagerRoom.Reader.Runtime;

internal static class VerifiedRuntimeProfiles
{
    // Intentionally empty in the first PoC.
    // A profile is added only after the build is independently verified with:
    // 1) exact module fingerprint,
    // 2) read-only field validation against in-game values,
    // 3) write + read-back verification on a disposable save,
    // 4) rollback validation.
    private static readonly RuntimeProfile[] Profiles = [];

    public static RuntimeProfile? Find(RuntimeModule executable, RuntimeModule gamePlugin)
    {
        return Profiles.FirstOrDefault(profile =>
            profile.ExecutableSha256.Equals(executable.Sha256, StringComparison.OrdinalIgnoreCase)
            && profile.GamePluginSha256.Equals(gamePlugin.Sha256, StringComparison.OrdinalIgnoreCase));
    }
}

internal sealed record RuntimeProfile(
    string Id,
    string ExecutableSha256,
    string GamePluginSha256);
