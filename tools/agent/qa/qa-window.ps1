# Starts the QA Chromium on Windows and gives the keyboard straight back. Called by qa-browser.mjs;
# prints the process id.
#
# Chromium activates its window when it starts, whatever show state the process is created with,
# so "do not take the keyboard" cannot be asked for up front. The script remembers which window
# was in front, starts the browser, waits for it to take over, hands the keyboard back to that
# window and puts the QA windows behind the others. The window stays open and watchable.
# Tried and dropped: starting minimised (Chromium activates anyway); minimise + show without
# activation (worked one time in two); picking "the next window" by z-order (picked wrong ones).
param([Parameter(Mandatory = $true)][string]$Chrome, [Parameter(Mandatory = $true)][string]$ArgLine)
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class QaWin {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars;
    public int dwFillAttribute; public int dwFlags; public short wShowWindow; public short cbReserved2;
    public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcess(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);

  public static int Start(string exe, string args) {
    STARTUPINFO si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    PROCESS_INFORMATION pi;
    StringBuilder cmd = new StringBuilder("\"" + exe + "\" " + args);
    if (!CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x00000200 /* CREATE_NEW_PROCESS_GROUP */, IntPtr.Zero, null, ref si, out pi)) return -Marshal.GetLastWin32Error();
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    return pi.dwProcessId;
  }

  static uint Owner(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return p; }
  public static bool InFront(int pid) { return Owner(GetForegroundWindow()) == (uint)pid; }

  /// Hand the keyboard to `target`. A background process may not do this on its own; attached to the
  /// input of the window that is in front, it may. No key or click is sent to anyone.
  public static bool GiveFront(IntPtr target) {
    uint p; uint front = GetWindowThreadProcessId(GetForegroundWindow(), out p);
    uint me = GetCurrentThreadId();
    AttachThreadInput(me, front, true);
    bool ok = SetForegroundWindow(target);
    AttachThreadInput(me, front, false);
    return ok;
  }

  /// Every visible window of the process goes behind the others, without being activated.
  public static void ToBack(int pid) {
    EnumWindows((h, l) => { if (Owner(h) == (uint)pid && IsWindowVisible(h)) SetWindowPos(h, new IntPtr(1) /* HWND_BOTTOM */, 0, 0, 0, 0, 0x0013 /* NOSIZE | NOMOVE | NOACTIVATE */); return true; }, IntPtr.Zero);
  }
}
'@
$previous = [QaWin]::GetForegroundWindow()
$id = [QaWin]::Start($Chrome, $ArgLine)
if ($id -le 0) { Write-Error "CreateProcess failed ($id)"; exit 1 }
# Chromium raises its windows in a burst a few seconds after the process starts; it can do so twice.
$gaveBack = 0
for ($waited = 0; $waited -lt 12000; $waited += 100) {
  if ([QaWin]::InFront($id)) {
    Start-Sleep -Milliseconds 400
    [QaWin]::ToBack($id)
    if ([QaWin]::IsWindow($previous)) { [void][QaWin]::GiveFront($previous) }
    $gaveBack++
    if ($gaveBack -ge 2) { break }
  } elseif ($gaveBack -gt 0 -and $waited -gt 6000) { break }
  Start-Sleep -Milliseconds 100
}
Write-Output $id
