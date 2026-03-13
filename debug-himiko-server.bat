@echo off
echo Stopping any running instance...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "pkill -f 'ts-node src/index.ts' || true"

echo Starting Himiko in debug mode (close this window to stop)...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "cd /home/spoon/himiko-bot && npm run dev"

echo.
echo Himiko has stopped.
pause
