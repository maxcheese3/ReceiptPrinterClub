# print-text.ps1
# Driver-mode text printing on Windows (PRINT_MODE=driver), for printers that
# ignore raw ESC/POS. The normal path is print-raw.ps1.
#
# Reads laid-out lines from stdin as JSON — the client has already wrapped
# them and picked each line's point size so it fills the paper width:
#   { "lines": [ { "pt": 7.1, "lh": 9.9, "invert": false,
#                  "spans": [ { "t": "From:", "b": true, "u": false } ] } ] }
# pt = Lucida Console size, lh = line height in points.

param(
  [string]$PrinterName = ""
)

[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing

$job   = [Console]::In.ReadToEnd() | ConvertFrom-Json
$lines = @($job.lines)

$pd = New-Object System.Drawing.Printing.PrintDocument
if ($PrinterName -ne "") { $pd.PrinterSettings.PrinterName = $PrinterName }
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

$fmt    = [System.Drawing.StringFormat]::GenericTypographic
$origin = [System.Drawing.PointF]::new(0, 0)
$fonts  = @{}
$spaceW = @{}

function Get-Font($pt, $bold, $underline, $emoji) {
  $key = "$pt|$bold|$underline|$emoji"
  if (-not $script:fonts.ContainsKey($key)) {
    $style = [System.Drawing.FontStyle]::Regular
    if ($bold)      { $style = $style -bor [System.Drawing.FontStyle]::Bold }
    if ($underline) { $style = $style -bor [System.Drawing.FontStyle]::Underline }
    $family = if ($emoji) { "Segoe UI Emoji" } else { "Lucida Console" }
    $script:fonts[$key] = New-Object System.Drawing.Font($family, [float]$pt, $style)
  }
  return $script:fonts[$key]
}

# GenericTypographic measures a lone space as zero width, so measure it as
# the difference between "X X" and "XX".
function Get-SpaceWidth($g, $font) {
  $key = "$($font.Size)|$($font.Style)"
  if (-not $script:spaceW.ContainsKey($key)) {
    $script:spaceW[$key] = [float]($g.MeasureString("X X", $font, $script:origin, $script:fmt).Width -
                                   $g.MeasureString("XX",  $font, $script:origin, $script:fmt).Width)
  }
  return $script:spaceW[$key]
}

function Is-Emoji($cp) {
  return ($cp -gt 0xFFFF) -or ($cp -ge 0x2600 -and $cp -le 0x27BF)
}

$lineIndex = 0

$pd.Add_PrintPage({
  param($sender, $ev)
  $g = $ev.Graphics
  $g.PageUnit = [System.Drawing.GraphicsUnit]::Point
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $clip = $g.VisibleClipBounds
  $y = [float]$clip.Y

  while ($script:lineIndex -lt $script:lines.Count) {
    $line = $script:lines[$script:lineIndex]
    $lh   = [float]$line.lh
    if ($y + $lh -gt ($clip.Y + $clip.Height) -and $y -gt $clip.Y) {
      $ev.HasMorePages = $true
      return
    }
    $script:lineIndex++

    $brush = [System.Drawing.Brushes]::Black
    if ($line.invert) {
      $g.FillRectangle([System.Drawing.Brushes]::Black, [float]$clip.X, $y, [float]$clip.Width, $lh)
      $brush = [System.Drawing.Brushes]::White
    }

    # Start just right of the edge: at exactly x=0 GDI can clip the first
    # character's left side bearing.
    $x = [float]$clip.X + 0.001
    foreach ($span in @($line.spans)) {
      $font  = Get-Font $line.pt $span.b $span.u $false
      $chars = [char[]][string]$span.t
      $i = 0
      while ($i -lt $chars.Length) {
        if ([char]::IsHighSurrogate($chars[$i]) -and ($i + 1) -lt $chars.Length) {
          $s = "$($chars[$i])$($chars[$i + 1])"; $i += 2
        } else {
          $s = "$($chars[$i])"; $i++
        }
        if ($s -eq " ") { $x += Get-SpaceWidth $g $font; continue }
        if ($s -eq [string][char]0xFE0F) { continue }

        $cp = [char]::ConvertToUtf32($s, 0)
        $f  = if (Is-Emoji $cp) { Get-Font $line.pt $false $false $true } else { $font }
        $g.DrawString($s, $f, $brush, [System.Drawing.PointF]::new($x, $y), $script:fmt)
        $x += $g.MeasureString($s, $f, $script:origin, $script:fmt).Width
      }
    }
    $y += $lh
  }
  $ev.HasMorePages = $false
})

$pd.Print()
foreach ($f in $fonts.Values) { $f.Dispose() }
$pd.Dispose()
