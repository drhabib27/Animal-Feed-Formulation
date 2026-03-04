$categories = @(69, 71, 10457, 72, 80, 78, 70, 74, 75, 1432, 76, 1433, 79, 77, 73)
$feedData = @{} # Dictionary to hold merged data

foreach ($cat in $categories) {
    Write-Host "`n--- Scraping Category ID: $cat ---"
    $url = "https://www.feedtables.com/content/table-dry-matter?feed_cat=All&parameter_cat=$cat&items_per_page=1000"
    Write-Host "Fetching $url"
    try {
        Start-Sleep -Milliseconds 500
        # Increased timeout and error action
        $html = Invoke-RestMethod -Uri $url -TimeoutSec 60 -ErrorAction Stop
        
        # 1. Extract the column headers
        $headerPattern = '(?si)<thead>(.*?)</thead>'
        $headerMatch = [regex]::Match($html, $headerPattern)
        
        if (-not $headerMatch.Success) {
            Write-Host "  No data found on this page, moving to next category."
            continue
        }
        
        $headersHtml = $headerMatch.Groups[1].Value
        $thPattern = '(?si)<th.*?>(.*?)</th>'
        $thMatches = [regex]::Matches($headersHtml, $thPattern)
        
        $parameters = @()
        foreach ($m in $thMatches) {
            $thContent = $m.Groups[1].Value.Trim()
            if ($thContent -match '<a.*?>(.*?)</a>') {
                $parameters += $matches[1].Trim()
            }
            else {
                $parameters += $thContent -replace '<[^>]+>', ''
            }
        }
        
        # 2. Extract the data rows
        $rowPattern = '(?si)<tr[^>]*>\s*<td[^>]*>\s*<a href="([^"]+)">(.*?)</a>\s*</td>(.*?)\s*</tr>'
        $rowMatches = [regex]::Matches($html, $rowPattern)
        
        if ($rowMatches.Count -eq 0) {
            Write-Host "  No rows found on this page, moving to next category."
            continue
        }

        Write-Host "  Found $($rowMatches.Count) rows"

        foreach ($m in $rowMatches) {
            if ($m.Success) {
                # Clean up ID to be consistent
                $rawId = $m.Groups[2].Value.Trim().ToLower() -replace '\s+', '_' -replace ',', '' -replace '[^\w_]', ''
                $rawName = $m.Groups[2].Value.Trim()
                
                if (-not $feedData.ContainsKey($rawId)) {
                    $feedData[$rawId] = @{
                        id        = $rawId
                        name      = $rawName
                        category  = "Imported"
                        price     = 0.50
                        nutrients = @{}
                    }
                }
                
                $tdsHtml = $m.Groups[3].Value
                $tdPattern = '(?si)<td[^>]*>\s*(.*?)\s*</td>'
                $tdMatches = [regex]::Matches($tdsHtml, $tdPattern)
                
                for ($i = 0; $i -lt $tdMatches.Count; $i++) {
                    $paramIndex = $i + 1
                    if ($paramIndex -lt $parameters.Count) {
                        $rawValue = $tdMatches[$i].Groups[1].Value -replace '</?br>', '' -replace '<[^>]+>', ''
                        $rawValue = $rawValue.Trim()

                        # Only save if there is an actual number/value
                        if ($rawValue -and $rawValue -ne "") {
                            $paramName = $parameters[$paramIndex] -replace '\s+', '_' -replace '[^\w_]', '' -replace '\(.*?\)', '' -replace '_$', ''
                            $paramName = $paramName.ToLower()

                            # Common renames for app JSON structural matching
                            if ($paramName -match '^dm') { $paramName = 'dm' }
                            elseif ($paramName -match '^cp') { $paramName = 'cp' }
                            elseif ($paramName -match '^cf_') { $paramName = 'cf' }
                            elseif ($paramName -match '^cfat') { $paramName = 'cfat' }
                            elseif ($paramName -match '^ash') { $paramName = 'ash' }
                            elseif ($paramName -match '^ndf') { $paramName = 'ndf' }
                            elseif ($paramName -match '^adf') { $paramName = 'adf' }
                            elseif ($paramName -match '^lignin') { $paramName = 'lignin' }
                            
                            $feedData[$rawId].nutrients[$paramName] = $rawValue
                        }
                    }
                }
            }
        }
    }
    catch {
        Write-Host "Error fetching or parsing $url `$_"
    }
}

# Convert hashmap to array
$finalArray = @()
foreach ($key in $feedData.Keys) {
    $obj = @{
        id       = $feedData[$key].id
        name     = $feedData[$key].name
        category = $feedData[$key].category
        price    = $feedData[$key].price
    }
    
    foreach ($nut in $feedData[$key].nutrients.Keys) {
        $obj[$nut] = $feedData[$key].nutrients[$nut]
    }
    
    $finalArray += $obj
}

$outputFile = "e:\Drive F\My Websites\Feed Formulation Website\feedtables_all_data.json"
$finalArray | ConvertTo-Json -Depth 5 | Out-File -FilePath $outputFile -Encoding utf8
Write-Host "`nDONE! Total unique ingredients compiled: $($finalArray.Count)"
Write-Host "Data saved to $outputFile"
