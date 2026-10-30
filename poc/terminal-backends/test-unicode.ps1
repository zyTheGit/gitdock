[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$e = [char]27
$cn = [string][char]0x4E2D + [char]0x6587
Write-Output ($cn + "OK " + $e + "[31mRED" + $e + "[0m")
