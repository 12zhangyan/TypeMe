param(
    [string]$Db      = 'typeme_dev',
    [string]$SqlFile = "$env:TEMP\typeme-verify\probe-mysql.sql"
)
# Runs probe-mysql.sql one statement at a time (split on "-- [Pn]" markers) so that
# every probe's real result / real error is captured independently.
$mysql  = 'C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe'
$common = @('--host=127.0.0.1','--port=3306','--user=root','--password=123456',
            '--default-character-set=utf8mb4', "--database=$Db", '--table', '--show-warnings')

$lines   = Get-Content -LiteralPath $SqlFile -Encoding UTF8
$markers = @()
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^--\s*\[([A-Za-z]+\d+)\]') { $markers += $i } }

function Invoke-Chunk([string[]]$chunk, [string]$label) {
    $sql = ($chunk | Where-Object { $_ -notmatch '^\s*--' }) -join "`n"
    if ([string]::IsNullOrWhiteSpace($sql)) { return }
    Write-Output "########## $label ##########"
    $out = & $mysql @common "--execute=$sql" 2>&1
    $out | Where-Object { $_ -notmatch 'Using a password on the command line' } |
        ForEach-Object { Write-Output "   $_" }
    Write-Output "   [mysql exit=$LASTEXITCODE]"
    Write-Output ""
}

if ($markers.Count -gt 0 -and $markers[0] -gt 0) {
    Invoke-Chunk $lines[0..($markers[0]-1)] 'PREP'
}
for ($m = 0; $m -lt $markers.Count; $m++) {
    $start = $markers[$m]
    $end   = if ($m + 1 -lt $markers.Count) { $markers[$m+1] - 1 } else { $lines.Count - 1 }
    Invoke-Chunk $lines[$start..$end] ($lines[$start].Trim())
}
