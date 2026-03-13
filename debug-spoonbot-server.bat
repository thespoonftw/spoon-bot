@echo off
echo Stopping any running instances...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "tmux kill-session -t himiko 2>/dev/null || true; tmux kill-session -t snek 2>/dev/null || true"

echo Starting himiko in debug mode (close this window to stop)...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "cd /home/spoon/spoon-bot && npm run dev"

echo.
echo Bot has stopped.
pause
