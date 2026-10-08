@echo off
cd /d "%~dp0"
set /p PW=<.server-password
echo Stopping services...
plink -batch -pw %PW% -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@100.124.96.73 "systemctl --user stop snek"

echo Starting snek in debug mode (close this window to stop)...
plink -pw %PW% -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@100.124.96.73 "cd /home/spoon/spoon-bot && npm run dev"

echo.
echo Restarting service...
plink -batch -pw %PW% -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@100.124.96.73 "systemctl --user start snek"
pause
