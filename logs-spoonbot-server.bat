@echo off
cd /d "%~dp0"
set /p PW=<.server-password
plink -batch -pw %PW% -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@100.124.96.73 "systemctl --user status snek --no-pager && echo '=== snek (last 20) ===' && tail -20 /home/spoon/spoon-bot/snek.log"
pause
