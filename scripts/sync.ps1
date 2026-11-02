$s = 'C:\Users\DELL\Downloads\new claude\flattr'
$d = 'C:\Users\DELL\Downloads\new claude\flattr-app'
robocopy $s $d /E /XD node_modules .next .git /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -lt 8) { exit 0 } else { exit $LASTEXITCODE }
