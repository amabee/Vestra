# Prepares the application icon from the supplied artwork.
#
# The source is a wide lockup - character plus wordmark - on a white
# background. None of that survives contact with a 16px tray slot: the text is
# unreadable, the frame is not square (which electron-builder rejects), and a
# white rectangle reads as a blob against a dark taskbar.
#
# So: find the character, crop to it, drop the white background, and write a
# square icon. The wordmark stays in the app where there is room for it.
#
# ASCII only - PowerShell 5.1 reads .ps1 as ANSI without a BOM.
param(
  [string]$Source = "$PSScriptRoot\..\apps\nova\renderer\src\resources\icon\icon.png",
  [string]$Out = "$PSScriptRoot\..\apps\nova\build\icon.png",
  [int]$Size = 1024,
  # Fraction of the image height to search for the character, so the wordmark
  # underneath is not included in the bounding box.
  [double]$SearchHeight = 0.52,
  # How tightly the subject fills the square. Below 1 crops in further.
  [double]$Fill = 1.0,
  # How the frame is squared.
  #   mean - split the difference: trim the sides a little, pad a little top and
  #          bottom. Best when the subject is only slightly off square, since it
  #          keeps the artwork large.
  #   pad  - square on the longer edge and pad the shorter one. Keeps every
  #          pixel, at the cost of empty bands. Needed for a wide lockup, where
  #          trimming the sides would cut the lettering off.
  [ValidateSet("mean", "pad")]
  [string]$SquareMode = "mean",
  # Nudge the crop vertically, to clear artwork that sits just outside the
  # subject - the top of the wordmark, for instance.
  [int]$OffsetY = 0,
  [int]$WhiteThreshold = 244
)

Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile((Resolve-Path $Source))
$w = $src.Width
$h = $src.Height
Write-Output "SOURCE: ${w}x${h}"

$bmp = New-Object System.Drawing.Bitmap $src
$src.Dispose()

# --- find the character -----------------------------------------------------
$limit = [int]($h * $SearchHeight)
$minX = $w; $maxX = 0; $minY = $h; $maxY = 0

for ($y = 0; $y -lt $limit; $y += 2) {
  for ($x = 0; $x -lt $w; $x += 2) {
    $c = $bmp.GetPixel($x, $y)
    if ($c.A -lt 8) { continue }
    if ($c.R -ge $WhiteThreshold -and $c.G -ge $WhiteThreshold -and $c.B -ge $WhiteThreshold) { continue }
    if ($x -lt $minX) { $minX = $x }
    if ($x -gt $maxX) { $maxX = $x }
    if ($y -lt $minY) { $minY = $y }
    if ($y -gt $maxY) { $maxY = $y }
  }
}

if ($maxX -le $minX -or $maxY -le $minY) {
  Write-Output "FAILED: no artwork found in the top $([int]($SearchHeight*100))%"
  exit 1
}

Write-Output "SUBJECT: x $minX..$maxX  y $minY..$maxY"

$cw = $maxX - $minX + 1
$ch = $maxY - $minY + 1

if ($SquareMode -eq "pad") {
  # Keep everything: square on the longer edge, centre the artwork, accept the
  # empty bands. Anything else would clip the wordmark.
  $side = [int]([Math]::Max($cw, $ch) * $Fill)

  Write-Output "SUBJECT SIZE: ${cw}x${ch}  CANVAS: ${side}x${side}  (padded)"

  $crop = New-Object System.Drawing.Bitmap $side, $side
  $g = [System.Drawing.Graphics]::FromImage($crop)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage(
    $bmp,
    (New-Object System.Drawing.Rectangle ([int](($side - $cw) / 2)), ([int](($side - $ch) / 2) + $OffsetY), $cw, $ch),
    $minX, $minY, $cw, $ch,
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $g.Dispose()
  $bmp.Dispose()
}
else {
  # Square on the mean of the two dimensions: trim a little from the sides, pad
  # a little at top and bottom. Squaring on the longer edge alone would leave
  # broad empty bands, and at 32px in a taskbar those bands are most of the
  # icon, shrinking the artwork to something unreadable.
  $side = [int](($cw + $ch) / 2 * $Fill)

  $srcX = $minX + [int](($cw - $side) / 2)
  $srcY = $minY + [int](($ch - $side) / 2) + $OffsetY

  $sx = [Math]::Max(0, $srcX)
  $sy = [Math]::Max(0, $srcY)
  $sw = [Math]::Min($side, $w - $sx)
  $sh = [Math]::Min($side, $h - $sy)

  Write-Output "SUBJECT SIZE: ${cw}x${ch}  CANVAS: ${side}x${side}  SOURCE RECT: ${sw}x${sh} at ${sx},${sy}"

  $crop = New-Object System.Drawing.Bitmap $side, $side
  $g = [System.Drawing.Graphics]::FromImage($crop)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  $g.DrawImage(
    $bmp,
    (New-Object System.Drawing.Rectangle ([int](($side - $sw) / 2)), ([int](($side - $sh) / 2)), $sw, $sh),
    $sx, $sy, $sw, $sh,
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $g.Dispose()
  $bmp.Dispose()
}

# --- drop the background ----------------------------------------------------
# Flood fill inward from the edges rather than clearing every white pixel:
# the highlights in the eyes are white too, and are enclosed by the artwork,
# so a fill that only travels through connected background leaves them intact.
$visited = New-Object 'bool[,]' $side, $side
$queue = New-Object System.Collections.Generic.Queue[int]

function Test-Background($c) {
  return ($c.R -ge $WhiteThreshold -and $c.G -ge $WhiteThreshold -and $c.B -ge $WhiteThreshold)
}

for ($x = 0; $x -lt $side; $x++) {
  foreach ($y in 0, ($side - 1)) {
    if (-not $visited[$x, $y] -and (Test-Background $crop.GetPixel($x, $y))) {
      $visited[$x, $y] = $true
      $queue.Enqueue($y * $side + $x)
    }
  }
}
for ($y = 0; $y -lt $side; $y++) {
  foreach ($x in 0, ($side - 1)) {
    if (-not $visited[$x, $y] -and (Test-Background $crop.GetPixel($x, $y))) {
      $visited[$x, $y] = $true
      $queue.Enqueue($y * $side + $x)
    }
  }
}

$clear = [System.Drawing.Color]::FromArgb(0, 255, 255, 255)
$cleared = 0

while ($queue.Count -gt 0) {
  $p = $queue.Dequeue()
  $x = $p % $side
  $y = [int](($p - $x) / $side)

  $crop.SetPixel($x, $y, $clear)
  $cleared++

  foreach ($d in @(@(1, 0), @(-1, 0), @(0, 1), @(0, -1))) {
    $nx = $x + $d[0]
    $ny = $y + $d[1]
    if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $side -or $ny -ge $side) { continue }
    if ($visited[$nx, $ny]) { continue }
    if (-not (Test-Background $crop.GetPixel($nx, $ny))) { continue }
    $visited[$nx, $ny] = $true
    $queue.Enqueue($ny * $side + $nx)
  }
}

Write-Output "CLEARED: $cleared background pixels"

# --- write it out -----------------------------------------------------------
$final = New-Object System.Drawing.Bitmap $Size, $Size
$g = [System.Drawing.Graphics]::FromImage($final)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($crop, 0, 0, $Size, $Size)
$g.Dispose()
$crop.Dispose()

$dir = Split-Path $Out -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$final.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$final.Dispose()

Write-Output "SAVED: $Out (${Size}x${Size})"
