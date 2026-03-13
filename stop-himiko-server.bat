@echo off
echo Stopping Himiko bot on server...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "pkill -f 'ts-node src/index.ts' && echo Bot stopped || echo Bot was not running"
pause
