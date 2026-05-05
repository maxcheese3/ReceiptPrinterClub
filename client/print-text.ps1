# print-text.ps1
# Prints text to a thermal receipt printer via Win32 GDI.
# Uses Courier New (monospace) for ASCII art and aligned text.
# Full Unicode/emoji support via Segoe UI Emoji fallback.

param(
  [string]$PrinterName = "",
  [int]$FontSize = 9
)

[Console]::InputEncoding  = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Drawing

$inputText = [Console]::In.ReadToEnd()

$pd = New-Object System.Drawing.Printing.PrintDocument
if ($PrinterName -ne "") { $pd.PrinterSettings.PrinterName = $PrinterName }
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

# Monospace for body (ASCII art, aligned columns)
$fontBody  = New-Object System.Drawing.Font("Courier New", $FontSize,    [System.Drawing.FontStyle]::Regular)
# Smaller sans-serif for meta lines (From, Received, Via)
$fontMeta  = New-Object System.Drawing.Font("Arial",       ($FontSize-2), [System.Drawing.FontStyle]::Regular)
# Separator lines
$fontSep   = New-Object System.Drawing.Font("Courier New", ($FontSize-2), [System.Drawing.FontStyle]::Regular)
# Emoji / symbol fallback
$fontEmoji = New-Object System.Drawing.Font("Segoe UI Emoji", $FontSize, [System.Drawing.FontStyle]::Regular)

$brush = [System.Drawing.Brushes]::Black

function Is-Meta($line) { return $line -match "^(From:|Email:|Received:|Via:)\s" }
function Is-Sep($line)  { return $line -match "^[=\-]{3,}$" }

$rawLines    = $inputText -split "`r?`n"
$parsedLines = foreach ($line in $rawLines) {
  if     (Is-Sep  $line) { [PSCustomObject]@{ Text=$line; Kind="sep"  } }
  elseif (Is-Meta $line) { [PSCustomObject]@{ Text=$line; Kind="meta" } }
  else                   { [PSCustomObject]@{ Text=$line; Kind="body" } }
}

$allLines  = [System.Collections.Generic.List[object]]::new()
$lineIndex = 0

$pd.Add_PrintPage({
  param($sender, $ev)

  $g    = $ev.Graphics
  $clip = $g.VisibleClipBounds
  $pageW = [int]$clip.Width
  $x     = [int]$clip.X
  $y     = [int]$clip.Y

  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

  if ($script:allLines.Count -eq 0) {
    foreach ($entry in $script:parsedLines) {
      $fnt = switch ($entry.Kind) {
        "meta" { $script:fontMeta }
        "sep"  { $script:fontSep  }
        default { $script:fontBody }
      }
      $raw = $entry.Text
      if ($raw.Trim() -eq "") {
        $script:allLines.Add([PSCustomObject]@{ Text=""; Kind=$entry.Kind })
        continue
      }
      # Word-wrap — split on spaces but preserve runs of spaces (ASCII art)
      # For body text we wrap on spaces; for ASCII art lines just truncate at page width
      $words   = $raw -split "(?<=\s)(?=\S)"  # split keeping whitespace with preceding word
      $current = ""
      foreach ($word in $words) {
        $test  = $current + $word
        $testW = [int]$g.MeasureString($test, $fnt, [int]::MaxValue,
                    [System.Drawing.StringFormat]::GenericTypographic).Width
        if ($testW -gt $pageW -and $current -ne "") {
          $script:allLines.Add([PSCustomObject]@{ Text=$current.TrimEnd(); Kind=$entry.Kind })
          $current = $word.TrimStart()
        } else {
          $current = $test
        }
      }
      if ($current.Trim() -ne "") {
        $script:allLines.Add([PSCustomObject]@{ Text=$current.TrimEnd(); Kind=$entry.Kind })
      }
    }
  }

  while ($script:lineIndex -lt $script:allLines.Count) {
    $entry = $script:allLines[$script:lineIndex]
    $fnt   = switch ($entry.Kind) {
      "meta" { $script:fontMeta }
      "sep"  { $script:fontSep  }
      default { $script:fontBody }
    }

    $lineH = [int][Math]::Ceiling($fnt.GetHeight($g)) + 1

    if ($entry.Text -ne "") {
      # Per-glyph rendering: use emoji font for unicode symbols/emoji
      $cx     = [float]$x
      $chars  = [char[]]$entry.Text
      $ci     = 0
      while ($ci -lt $chars.Length) {
        $ch = $chars[$ci]
        $charStr = ""
        if ([char]::IsHighSurrogate($ch) -and ($ci+1) -lt $chars.Length -and [char]::IsLowSurrogate($chars[$ci+1])) {
          $charStr = "" + $ch + $chars[$ci+1]; $ci += 2
        } else {
          $charStr = "" + $ch; $ci++
        }
        $codepoint = [char]::ConvertToUtf32($charStr, 0)
        $gf = if ($codepoint -gt 0xFFFF -or
                  ($codepoint -ge 0x2600 -and $codepoint -le 0x27BF) -or
                  ($codepoint -ge 0x1F300 -and $codepoint -le 0x1FAFF)) {
          $script:fontEmoji
        } else { $fnt }

        $fmt  = [System.Drawing.StringFormat]::GenericTypographic
        $charW = $g.MeasureString($charStr, $gf, [int]::MaxValue, $fmt).Width
        $g.DrawString($charStr, $gf, $script:brush, $cx, [float]$y, $fmt)
        $cx += $charW
      }
    }

    $y += $lineH
    $script:lineIndex++

    if ($y + $lineH -gt ($clip.Y + $clip.Height) -and $script:lineIndex -lt $script:allLines.Count) {
      $ev.HasMorePages = $true; return
    }
  }
  $ev.HasMorePages = $false
})

$pd.Print()
$fontBody.Dispose(); $fontMeta.Dispose(); $fontSep.Dispose(); $fontEmoji.Dispose()
$pd.Dispose()
