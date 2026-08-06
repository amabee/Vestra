<#
.SYNOPSIS
  Splits the opening/ending artwork into two backgroundless markers.

.DESCRIPTION
  The supplied file is 24-bit RGB - no alpha channel - with the pair of
  characters sitting on solid black. Drawn straight into the interface that
  black is opaque, so each marker rendered as a dark rectangle with a barely
  visible figure inside it.

  This lifts the background out, crops each character to the pixels actually
  drawn, and writes a square marker per side.

  The background is removed by filling inward from the edges rather than by
  clearing every dark pixel: the characters have near-black outlines and hair,
  and a blanket threshold would punch holes straight through them. Only black
  reachable from the border is background.

  ASCII only - PowerShell 5.1 reads .ps1 as ANSI without a BOM.
#>
param(
  [string]$Source = "$PSScriptRoot\..\apps\nova\renderer\src\resources\icon\op_ed.png",
  [string]$OutDir = "$PSScriptRoot\..\apps\nova\renderer\src\resources\icon",
  [int]$Size = 256,
  [int]$DarkThreshold = 40
)

Add-Type -AssemblyName System.Drawing

$img = [System.Drawing.Image]::FromFile((Resolve-Path $Source).Path)
$w = $img.Width
$h = $img.Height

# Redraw into a format that has somewhere to put the alpha.
$bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($img, 0, 0, $w, $h)
$g.Dispose()
$img.Dispose()

Write-Output "SOURCE: ${w}x${h} redrawn as 32bpp"

# --- lift the background ----------------------------------------------------
$visited = New-Object 'bool[,]' $w, $h
$queue = New-Object System.Collections.Generic.Queue[int]

function Test-Dark($c) {
  # Rec. 601 luma; a flat average would treat blue too generously.
  return (((0.299 * $c.R) + (0.587 * $c.G) + (0.114 * $c.B)) -le $DarkThreshold)
}

for ($x = 0; $x -lt $w; $x++) {
  foreach ($y in @(0, ($h - 1))) {
    if (-not $visited[$x, $y] -and (Test-Dark $bmp.GetPixel($x, $y))) {
      $visited[$x, $y] = $true
      $queue.Enqueue($y * $w + $x)
    }
  }
}
for ($y = 0; $y -lt $h; $y++) {
  foreach ($x in @(0, ($w - 1))) {
    if (-not $visited[$x, $y] -and (Test-Dark $bmp.GetPixel($x, $y))) {
      $visited[$x, $y] = $true
      $queue.Enqueue($y * $w + $x)
    }
  }
}

$clear = [System.Drawing.Color]::FromArgb(0, 0, 0, 0)
$cleared = 0

while ($queue.Count -gt 0) {
  $p = $queue.Dequeue()
  $x = $p % $w
  $y = [int](($p - $x) / $w)

  $bmp.SetPixel($x, $y, $clear)
  $cleared++

  foreach ($d in @(@(1, 0), @(-1, 0), @(0, 1), @(0, -1))) {
    $nx = $x + $d[0]
    $ny = $y + $d[1]
    if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $w -or $ny -ge $h) { continue }
    if ($visited[$nx, $ny]) { continue }
    if (-not (Test-Dark $bmp.GetPixel($nx, $ny))) { continue }
    $visited[$nx, $ny] = $true
    $queue.Enqueue($ny * $w + $nx)
  }
}

Write-Output "CLEARED: $cleared of $($w * $h) pixels ($([math]::Round(100 * $cleared / ($w * $h), 1))%)"

# --- split, crop, save ------------------------------------------------------
$half = [int]($w / 2)

foreach ($side in @(
    @{ Name = "opening"; X0 = 0; X1 = $half - 1 },
    @{ Name = "ending"; X0 = $half; X1 = $w - 1 }
  )) {

  $minX = $side.X1; $maxX = $side.X0; $minY = $h; $maxY = 0

  for ($y = 0; $y -lt $h; $y += 2) {
    for ($x = $side.X0; $x -le $side.X1; $x += 2) {
      if ($bmp.GetPixel($x, $y).A -le 24) { continue }
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }

  if ($maxX -le $minX -or $maxY -le $minY) {
    Write-Output "$($side.Name): FAILED - nothing left after clearing"
    continue
  }

  $cw = $maxX - $minX + 1
  $ch = $maxY - $minY + 1
  $canvas = [int]([Math]::Max($cw, $ch) * 1.04)

  Write-Output "$($side.Name): subject ${cw}x${ch} -> canvas ${canvas}"

  $square = New-Object System.Drawing.Bitmap $canvas, $canvas
  $g = [System.Drawing.Graphics]::FromImage($square)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage(
    $bmp,
    (New-Object System.Drawing.Rectangle ([int](($canvas - $cw) / 2)), ([int](($canvas - $ch) / 2)), $cw, $ch),
    $minX, $minY, $cw, $ch,
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $g.Dispose()

  $final = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($final)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($square, 0, 0, $Size, $Size)
  $g.Dispose()
  $square.Dispose()

  $path = Join-Path $OutDir "$($side.Name).png"
  $final.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $final.Dispose()

  Write-Output "  saved $path ($([math]::Round((Get-Item $path).Length / 1KB, 1)) KB)"
}

$bmp.Dispose()
