$content = Get-Content -Path "feedtables_all_data.json" -Raw
$newContent = "const INRA_DB = " + $content + ";"
Set-Content -Path "feedtables_data.js" -Value $newContent -Encoding UTF8
