# print-image.ps1
# Prints an image to a thermal receipt printer via Win32 GDI.
# Uses VisibleClipBounds for true printable width (no right-side cropping).

param(
  [string]$ImagePath,
  [string]$PrinterName = ""
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $ImagePath)) {
  Write-Error "Image file not found: $ImagePath"
  exit 1
}

$image = [System.Drawing.Image]::FromFile($ImagePath)

$pd = New-Object System.Drawing.Printing.PrintDocument
if ($PrinterName -ne "") { $pd.PrinterSettings.PrinterName = $PrinterName }
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

$pd.Add_PrintPage({
  param($sender, $ev)

  $g    = $ev.Graphics
  # Use VisibleClipBounds — the actual pixels the printer will put ink on
  $clip = $g.VisibleClipBounds
  $pageW = [int]$clip.Width
  $pageH = [int]$clip.Height

  $imgW = $image.Width
  $imgH = $image.Height

  # Scale to fill full printable width; height follows aspect ratio
  $scale = $pageW / $imgW
  $drawW = [int]($imgW * $scale)
  $drawH = [int]($imgH * $scale)

  # Safety cap for fixed-height paper (laser etc.)
  if ($drawH -gt $pageH) {
    $scale = $pageH / $imgH
    $drawW = [int]($imgW * $scale)
    $drawH = [int]($imgH * $scale)
  }

  $destRect = New-Object System.Drawing.Rectangle([int]$clip.X, [int]$clip.Y, $drawW, $drawH)
  $ev.Graphics.DrawImage($image, $destRect)
  $ev.HasMorePages = $false
})

$pd.Print()
$image.Dispose()
$pd.Dispose()
