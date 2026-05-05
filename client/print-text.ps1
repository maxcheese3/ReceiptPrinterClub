# print-text.ps1
# Thermal receipt printer text output via Win32 GDI.
# - Courier New monospace (ASCII art, aligned columns)
# - Preserves ALL leading whitespace exactly
# - Tight line spacing (no internal leading)
# - Unicode/emoji via Segoe UI Emoji fallback per glyph

param(
  [string]$PrinterName = "",
  [int]$FontSize = 9
)

[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing

$inputText = [Console]::In.ReadToEnd()
$rawLines  = $inputText -split "`r?`n"

$pd = New-Object System.Drawing.Printing.PrintDocument
if ($PrinterName -ne "") { $pd.PrinterSettings.PrinterName = $PrinterName }
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

$fontBody  = New-Object System.Drawing.Font("Courier New",    $FontSize, [System.Drawing.FontStyle]::Regular)
$fontEmoji = New-Object System.Drawing.Font("Segoe UI Emoji", $FontSize, [System.Drawing.FontStyle]::Regular)
$brush     = [System.Drawing.Brushes]::Black

$lineIndex = 0

$pd.Add_PrintPage({
  param($sender, $ev)
  $g    = $ev.Graphics
  $clip = $g.VisibleClipBounds
  $x    = [float]$clip.X
  $y    = [float]$clip.Y

  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

  # Tight line height: use the font's design em height converted to pixels,
  # not GetHeight() which includes internal leading/line gap
  $dpi    = $g.DpiY
  $lineH  = [float]($script:fontBody.Size * $dpi / 72.0)

  while ($script:lineIndex -lt $script:rawLines.Count) {
    $line = $script:rawLines[$script:lineIndex]
    $script:lineIndex++

    if ($line.Length -gt 0) {
      # Draw character by character so we can switch to emoji font per glyph
      # AND preserve leading spaces (DrawString at a PointF never trims)
      $cx   = $x
      $chars = [char[]]$line
      $ci    = 0

      while ($ci -lt $chars.Length) {
        $ch = $chars[$ci]
        if ([char]::IsHighSurrogate($ch) -and ($ci+1) -lt $chars.Length -and [char]::IsLowSurrogate($chars[$ci+1])) {
          $charStr = "$ch$($chars[$ci+1])"; $ci += 2
        } else {
          $charStr = "$ch"; $ci++
        }

        $cp = [char]::ConvertToUtf32($charStr, 0)
        $gf = if ($cp -gt 0xFFFF -or ($cp -ge 0x2600 -and $cp -le 0x27BF) -or ($cp -ge 0x1F300 -and $cp -le 0x1FAFF)) {
          $script:fontEmoji
        } else { $script:fontBody }

        # DrawString at PointF — GDI never trims leading spaces this way
        $pt  = [System.Drawing.PointF]::new($cx, $y)
        $sz  = $g.MeasureString($charStr, $gf, $pt, [System.Drawing.StringFormat]::GenericTypographic)
        $g.DrawString($charStr, $gf, $script:brush, $pt, [System.Drawing.StringFormat]::GenericTypographic)
        $cx += $sz.Width
      }
    }

    $y += $lineH

    if ($y + $lineH -gt ($clip.Y + $clip.Height) -and $script:lineIndex -lt $script:rawLines.Count) {
      $ev.HasMorePages = $true; return
    }
  }
  $ev.HasMorePages = $false
})

$pd.Print()
$fontBody.Dispose()
$fontEmoji.Dispose()
$pd.Dispose()
