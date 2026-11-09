@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
set "LK_SHORTCUT_BASE=%~dp0"
set "LK_SHORTCUT_NAME=Літакова Комісія"
echo Створення ярлика «Літакова Комісія» з новою емблемою...
powershell.exe -NoLogo -NoProfile -NonInteractive -Command "$ErrorActionPreference='Stop'; try { $base=$env:LK_SHORTCUT_BASE; $exe=Join-Path $base 'Litakova-Komisiia-PC.exe'; $source=Join-Path $base '@ICON_FILE@'; if (!(Test-Path -LiteralPath $exe -PathType Leaf) -or !(Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Extract all ZIP files into the same folder first.' }; $branding=Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'LitakovaKomisiiaPC\branding'; [void][IO.Directory]::CreateDirectory($branding); $icon=Join-Path $branding ([IO.Path]::GetFileName($source)); Copy-Item -LiteralPath $source -Destination $icon -Force; $desktop=[Environment]::GetFolderPath('DesktopDirectory'); if (!$desktop -or !(Test-Path -LiteralPath $desktop -PathType Container)) { throw 'Desktop folder is unavailable.' }; $shell=New-Object -ComObject WScript.Shell; $index=0; do { $name=$env:LK_SHORTCUT_NAME; if ($index -gt 0) { $name+=' ('+($index+1)+')' }; $path=Join-Path $desktop ($name+'.lnk'); if (!(Test-Path -LiteralPath $path)) { break }; $existing=$shell.CreateShortcut($path); if ($existing.TargetPath -eq $exe) { break }; $index++; if ($index -gt 99) { throw 'No free shortcut name.' } } while ($true); $link=$shell.CreateShortcut($path); $link.TargetPath=$exe; $link.WorkingDirectory=$base; $link.IconLocation=$icon+',0'; $link.Description=$env:LK_SHORTCUT_NAME; $link.WindowStyle=1; $link.Save(); if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw 'The shortcut was not saved.' }; $saved=$shell.CreateShortcut($path); if ($saved.TargetPath -ne $exe -or $saved.IconLocation -ne ($icon+',0')) { throw 'The shortcut could not be verified.' }; Write-Host $path; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 goto failed
echo Готово. Запускайте програму через новий ярлик «Літакова Комісія» на робочому столі.
pause
exit /b 0
:failed
echo Ярлик не створено. Перевірте повідомлення вище та чи розпаковані всі файли архіву.
pause
exit /b 1
