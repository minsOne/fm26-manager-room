using System.Diagnostics;

namespace Fm26.ManagerRoom.Reader.Runtime;

internal sealed class FmProcessLocator
{
    public Process? FindBestMatch(string processName)
    {
        var normalized = Path.GetFileNameWithoutExtension(processName);

        Process[] processes;
        try
        {
            processes = Process.GetProcessesByName(normalized);
        }
        catch
        {
            return null;
        }

        if (processes.Length == 0)
        {
            return FindFallback();
        }

        return processes
            .OrderByDescending(Score)
            .FirstOrDefault();
    }

    private static Process? FindFallback()
    {
        return Process.GetProcesses()
            .Where(IsLikelyFm26)
            .OrderByDescending(Score)
            .FirstOrDefault();
    }

    private static int Score(Process process)
    {
        var score = 0;

        try
        {
            var path = process.MainModule?.FileName ?? string.Empty;
            if (path.Contains("Football Manager 26", StringComparison.OrdinalIgnoreCase))
            {
                score += 100;
            }

            if (Path.GetFileName(path).Equals("fm.exe", StringComparison.OrdinalIgnoreCase))
            {
                score += 50;
            }
        }
        catch
        {
            // Access can fail for protected or mismatched processes.
        }

        return score;
    }

    private static bool IsLikelyFm26(Process process)
    {
        try
        {
            var path = process.MainModule?.FileName ?? string.Empty;
            var fileName = Path.GetFileName(path);

            return fileName.Equals("fm.exe", StringComparison.OrdinalIgnoreCase)
                || path.Contains("Football Manager 26", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }
}
