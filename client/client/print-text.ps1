# print-text.ps1
# Thermal receipt printer — Win32 GDI
# Body: Lucida Console Bold at $FontSize pt
# Meta (From/Received/Via/separators): Lucida Console Bold hardcoded 9pt

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

$fontBody  = New-Object System.Drawing.Font("Lucida Console", $FontSize, [System.Drawing.FontStyle]::Bold)
$fontMeta  = New-Object System.Drawing.Font("Lucida Console", 9,         [System.Drawing.FontStyle]::Bold)
$fontEmoji = New-Object System.Drawing.Font("Segoe UI Emoji", $FontSize, [System.Drawing.FontStyle]::Regular)
$brush     = [System.Drawing.Brushes]::Black
$fmt       = [System.Drawing.StringFormat]::GenericTypographic

# ── Space width: measure at script scope using temp bitmap ────────────────────
# GenericTypographic drops spaces entirely. Workaround: measure("X X")-measure("XX").
# MUST be at script scope — Add_PrintPage has its own local scope.
$_bmp  = New-Object System.Drawing.Bitmap(1, 1)
$_g    = [System.Drawing.Graphics]::FromImage($_bmp)
$_o    = [System.Drawing.PointF]::new(0, 0)

$spaceWBody = [float]($_g.MeasureString("X X", $fontBody, $_o, $fmt).Width -
                       $_g.MeasureString("XX",  $fontBody, $_o, $fmt).Width)
$spaceWMeta = [float]($_g.MeasureString("X X", $fontMeta, $_o, $fmt).Width -
                       $_g.MeasureString("XX",  $fontMeta, $_o, $fmt).Width)

$_g.Dispose(); $_bmp.Dispose()

# ── Line height: fixed tight multiplier ──────────────────────────────────────
# 0.72 of the em-square gives very tight packing with minimal gap between lines.
# The em-square for Lucida Console Bold includes generous internal spacing;
# 0.72 reduces to approximately cap-height only.
$_lineMultiplier = [float]0.62

function Is-Meta($line) {
  return $line -match "^(From:|Email:|Received:|Time:|Via:|={3,}|-{3,})"
}

$lineIndex = 0

$pd.Add_PrintPage({
  param($sender, $ev)
  $g    = $ev.Graphics
  $clip = $g.VisibleClipBounds
  $x    = [float]$clip.X
  $y    = [float]$clip.Y

  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

  # Pixel line height = em-square * tight multiplier
  $lineHBody = [float]($script:fontBody.Size * $g.DpiY / 72.0 * $script:_lineMultiplier)
  $lineHMeta = [float]($script:fontMeta.Size * $g.DpiY / 72.0 * $script:_lineMultiplier)

  while ($script:lineIndex -lt $script:rawLines.Count) {
    $line  = $script:rawLines[$script:lineIndex]
    $script:lineIndex++

    $isMeta = Is-Meta $line
    $font   = if ($isMeta) { $script:fontMeta   } else { $script:fontBody   }
    $lineH  = if ($isMeta) { $lineHMeta          } else { $lineHBody          }
    $spaceW = if ($isMeta) { $script:spaceWMeta  } else { $script:spaceWBody  }

    if ($line.Length -gt 0) {
      # Start cx at x + 0.001 to avoid GDI's x=0 side-bearing artefact
      # that causes the first character's left bearing to go negative,
      # making leading spaces appear to vanish on the very first line.
      $cx    = $x + 0.001
      $chars = [char[]]$line
      $ci    = 0

      while ($ci -lt $chars.Length) {
        if ([char]::IsHighSurrogate($chars[$ci]) -and
            ($ci+1) -lt $chars.Length -and
            [char]::IsLowSurrogate($chars[$ci+1])) {
          $charStr = "$($chars[$ci])$($chars[$ci+1])"; $ci += 2
        } else {
          $charStr = "$($chars[$ci])"; $ci++
        }

        if ($charStr -eq " ") {
          $cx += $spaceW
          continue
        }

        $cp = [char]::ConvertToUtf32($charStr, 0)
        $gf = if ($cp -gt 0xFFFF -or
                  ($cp -ge 0x2600 -and $cp -le 0x27BF) -or
                  ($cp -ge 0x1F300 -and $cp -le 0x1FAFF)) {
          $script:fontEmoji
        } else { $font }

        $w = $g.MeasureString($charStr, $gf, $script:_o, $script:fmt).Width
        $g.DrawString($charStr, $gf, $script:brush,
                      [System.Drawing.PointF]::new($cx, $y), $script:fmt)
        $cx += $w
      }
    }

    $y += $lineH

    if ($y + $lineH -gt ($clip.Y + $clip.Height) -and
        $script:lineIndex -lt $script:rawLines.Count) {
      $ev.HasMorePages = $true
      return
    }
  }
  $ev.HasMorePages = $false
})

$pd.Print()
$fontBody.Dispose(); $fontMeta.Dispose(); $fontEmoji.Dispose()
$pd.Dispose()
