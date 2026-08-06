<#
.SYNOPSIS
  Capture a specific window and report what is actually on it.

.DESCRIPTION
  Screen capture by coordinates returns whatever happens to be topmost, which
  during this project silently produced images of VS Code, a browser and the
  task switcher while appearing to succeed. This targets a window by title
  instead: it locates the window, brings it forward, reads its true visual
  bounds from the compositor, and captures that rectangle.

  Screen capture rather than PrintWindow is deliberate. mpv renders through
  Direct3D into its own window, and PrintWindow frequently returns black for
  GPU-composited content, which is the exact case this exists to check.

  Pixel statistics are printed alongside the image so a result can be asserted
  rather than eyeballed. A max of 0 across the sample means nothing is drawn.

  ASCII only, on purpose: PowerShell 5.1 reads .ps1 files as ANSI unless they
  carry a BOM, and non-ASCII punctuation breaks the parser.

.EXAMPLE
  .\capture-window.ps1 -Title "Vestra" -Out shot.png

.EXAMPLE
  # Just the video area, skipping the title bar and the control strip.
  .\capture-window.ps1 -Title "Vestra" -Top 44 -Bottom 90
#>
param(
  [string]$Title = "",
  [string[]]$ProcessName = @("electron", "Vestra Nova"),
  [string]$Out = "$PSScriptRoot\capture.png",
  [int]$Top = 0,
  [int]$Bottom = 0,
  [int]$Left = 0,
  [int]$Right = 0,
  [int]$SettleMs = 350
)

Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int max);

  [DllImport("user32.dll")]
  public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumProc cb, IntPtr param);
  public delegate bool EnumProc(IntPtr h, IntPtr param);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  // GetWindowRect includes an invisible resize border on Windows 10+, which
  // would offset every capture. The compositor's frame bounds are the real
  // visual edges.
  [DllImport("dwmapi.dll")]
  public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);

  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr h, out RECT r);

  public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
}
"@

# Which processes are allowed to own the window.
#
# Matching on title text alone is not sound: the editor's own window was called
# "Vestra - Visual Studio Code" and matched "Vestra", so the script captured the
# wrong window and cheerfully reported that something was rendering. Ownership
# is the reliable filter; the title only narrows between that process's windows.
$allowed = @()
foreach ($name in $ProcessName) {
  $allowed += (Get-Process -Name $name -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
}

if ($allowed.Count -eq 0) {
  Write-Output "NOT RUNNING: no process named $($ProcessName -join ', ')"
  exit 1
}

$script:found = [IntPtr]::Zero
$script:foundTitle = ""
$script:bestArea = -1

$callback = [Win+EnumProc] {
  param($h, $p)

  if (-not [Win]::IsWindowVisible($h)) { return $true }

  # $pid is a read-only automatic variable in PowerShell; using it here fails
  # on every window and yields "no visible window owned by ...".
  $owner = 0
  [void][Win]::GetWindowThreadProcessId($h, [ref]$owner)
  if ($allowed -notcontains $owner) { return $true }

  $sb = New-Object System.Text.StringBuilder 512
  [void][Win]::GetWindowTextW($h, $sb, $sb.Capacity)
  $text = $sb.ToString()

  if ($Title -and $text -notlike "*$Title*") { return $true }

  # Several windows belong to the app (main, video surface, controls overlay).
  # The largest is the one worth looking at.
  $r = New-Object Win+RECT
  [void][Win]::GetWindowRect($h, [ref]$r)
  $area = ($r.Right - $r.Left) * ($r.Bottom - $r.Top)

  if ($area -gt $script:bestArea) {
    $script:bestArea = $area
    $script:found = $h
    $script:foundTitle = $text
  }

  return $true
}

[void][Win]::EnumWindows($callback, [IntPtr]::Zero)

if ($script:found -eq [IntPtr]::Zero) {
  Write-Output "NOT FOUND: no visible window owned by $($ProcessName -join ', ')"
  exit 1
}

Write-Output "WINDOW: '$($script:foundTitle)' (owned by $($ProcessName -join '/'))"

# Bring it forward, or the capture records whatever is covering it.
[void][Win]::ShowWindow($script:found, 9)   # SW_RESTORE
[void][Win]::SetForegroundWindow($script:found)
Start-Sleep -Milliseconds $SettleMs

$rect = New-Object Win+RECT
$size = [System.Runtime.InteropServices.Marshal]::SizeOf($rect)

if ([Win]::DwmGetWindowAttribute($script:found, [Win]::DWMWA_EXTENDED_FRAME_BOUNDS, [ref]$rect, $size) -ne 0) {
  [void][Win]::GetWindowRect($script:found, [ref]$rect)
}

$x = $rect.Left + $Left
$y = $rect.Top + $Top
$w = ($rect.Right - $rect.Left) - $Left - $Right
$h = ($rect.Bottom - $rect.Top) - $Top - $Bottom

if ($w -lt 1 -or $h -lt 1) {
  Write-Output "EMPTY: computed region is ${w}x${h}"
  exit 1
}

Write-Output "REGION: ${w}x${h} at ${x},${y}"

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)

# Sample on a coarse grid; enough to tell "black" from "an image".
$values = @()
$stepX = [Math]::Max(1, [int]($w / 40))
$stepY = [Math]::Max(1, [int]($h / 25))

for ($py = 2; $py -lt $h - 2; $py += $stepY) {
  for ($px = 2; $px -lt $w - 2; $px += $stepX) {
    $c = $bmp.GetPixel($px, $py)
    $values += ($c.R + $c.G + $c.B) / 3
  }
}

$stats = $values | Measure-Object -Average -Minimum -Maximum
$mean = [math]::Round($stats.Average, 1)
$variance = ($values | ForEach-Object { [math]::Pow($_ - $stats.Average, 2) } | Measure-Object -Sum).Sum / $values.Count
$stdev = [math]::Round([math]::Sqrt($variance), 2)

Write-Output "PIXELS: samples=$($values.Count) mean=$mean min=$([math]::Round($stats.Minimum,1)) max=$([math]::Round($stats.Maximum,1)) stdev=$stdev"

if ($stats.Maximum -eq 0) {
  Write-Output "VERDICT: entirely black, nothing is being drawn here"
} elseif ($stdev -lt 2) {
  Write-Output "VERDICT: flat fill, a solid colour rather than an image"
} else {
  Write-Output "VERDICT: varied content, something is rendering"
}

$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()

Write-Output "SAVED: $Out"
