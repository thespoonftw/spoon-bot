@echo off
echo Starting Himiko bot on server...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "if pgrep -f 'ts-node src/index.ts' > /dev/null 2>&1; then echo Bot is already running; else cd /home/spoon/himiko-bot && setsid npm run dev >> bot.log 2>&1 & echo Bot started; fi"
pause
