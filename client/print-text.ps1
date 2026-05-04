# print-text.ps1
# Prints text to a thermal receipt printer via Win32 GDI.
# Uses VisibleClipBounds for true printable area (no cropping).

param(
  [string]$PrinterName = "",
  [string]$FontName = "Arial Black"
)

Add-Type -AssemblyName System.Drawing

$inputText  = [Console]::In.ReadToEnd()
$allLines   = [System.Collections.Generic.List[string]]::new()
$lineIndex  = 0

$pd = New-Object System.Drawing.Printing.PrintDocument
if ($PrinterName -ne "") { $pd.PrinterSettings.PrinterName = $PrinterName }
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)

# Fonts
$fontBody   = New-Object System.Drawing.Font("Arial Black", 9,  [System.Drawing.FontStyle]::Regular)
$fontMeta   = New-Object System.Drawing.Font("Arial",       7,  [System.Drawing.FontStyle]::Regular)
$fontSep    = New-Object System.Drawing.Font("Arial",       6,  [System.Drawing.FontStyle]::Regular)
$brush      = [System.Drawing.Brushes]::Black

# Parse the input — split into sections so we can use different fonts
# Format expected:
#   META lines start with a known prefix (FROM:, EMAIL:, RECEIVED:, VIA:)
#   SEP lines are all = or -
#   Everything else is body

function Is-Meta($line) {
  return $line -match "^(From:|Email:|Received:|Via:)\s"
}
function Is-Sep($line) {
  return $line -match "^[=\-]{3,}$"
}

$rawLines = $inputText -split "`r?`n"
# Store tuples as PSCustomObject
$parsedLines = foreach ($line in $rawLines) {
  if     (Is-Sep  $line) { [PSCustomObject]@{ Text=$line; Kind="sep"  } }
  elseif (Is-Meta $line) { [PSCustomObject]@{ Text=$line; Kind="meta" } }
  else                   { [PSCustomObject]@{ Text=$line; Kind="body" } }
}

$pd.Add_PrintPage({
  param($sender, $ev)

  $g = $ev.Graphics
  # VisibleClipBounds gives the true printable rectangle in printer units
  $clip      = $g.VisibleClipBounds
  $pageW     = [int]$clip.Width
  $x         = [int]$clip.X
  $y         = [int]$clip.Y

  # Build wrapped line list on first page once we have real page width
  if ($script:allLines.Count -eq 0) {
    foreach ($entry in $script:parsedLines) {
      $fnt = switch ($entry.Kind) {
        "meta" { $script:fontMeta }
        "sep"  { $script:fontSep  }
        default { $script:fontBody }
      }
      $raw = $entry.Text
      if ($raw.Trim() -eq "") {
        $script:allLines.Add("|BLANK|body")
        continue
      }
      # Word wrap using MeasureString against real page width
      $words   = $raw -split " "
      $current = ""
      foreach ($word in $words) {
        $test  = if ($current -eq "") { $word } else { "$current $word" }
        $testW = [int]$g.MeasureString($test, $fnt).Width
        if ($testW -gt $pageW -and $current -ne "") {
          $script:allLines.Add("$current|$($entry.Kind)")
          $current = $word
        } else {
          $current = $test
        }
      }
      if ($current -ne "") { $script:allLines.Add("$current|$($entry.Kind)") }
    }
  }

  while ($script:lineIndex -lt $script:allLines.Count) {
    $entry  = $script:allLines[$script:lineIndex]
    $parts  = $entry -split "\|"
    $text   = $parts[0]
    $kind   = $parts[1]

    $fnt = switch ($kind) {
      "meta" { $script:fontMeta }
      "sep"  { $script:fontSep  }
      default { $script:fontBody }
    }

    $lineH = [int][Math]::Ceiling($fnt.GetHeight($g))

    if ($text -ne "BLANK") {
      $g.DrawString($text, $fnt, $script:brush, [float]$x, [float]$y)
    }
    $y += $lineH + 1
    $script:lineIndex++

    if ($y + $lineH -gt ($clip.Y + $clip.Height) -and $script:lineIndex -lt $script:allLines.Count) {
      $ev.HasMorePages = $true
      return
    }
  }
  $ev.HasMorePages = $false
})

$pd.Print()
$fontBody.Dispose()
$fontMeta.Dispose()
$fontSep.Dispose()
$pd.Dispose()
