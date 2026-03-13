@echo off
plink -batch -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "echo '=== himiko (last 20) ===' && tail -20 /home/spoon/spoon-bot/bot.log && echo '=== snek (last 20) ===' && tail -20 /home/spoon/spoon-bot/snek.log"
pause
