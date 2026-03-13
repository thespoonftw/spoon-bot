@echo off
echo Stopping bot...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "pkill -f 'ts-node src/index.ts' && echo Bot stopped || echo Bot was not running"

echo Uploading files...
pscp -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" -r "C:\Users\Tablespoon\Desktop\himiko-bot\src" spoon@192.168.1.50:/home/spoon/himiko-bot/
pscp -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" "C:\Users\Tablespoon\Desktop\himiko-bot\package.json" spoon@192.168.1.50:/home/spoon/himiko-bot/
pscp -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" "C:\Users\Tablespoon\Desktop\himiko-bot\tsconfig.json" spoon@192.168.1.50:/home/spoon/himiko-bot/
pscp -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" "C:\Users\Tablespoon\Desktop\himiko-bot\.env" spoon@192.168.1.50:/home/spoon/himiko-bot/

echo Installing dependencies...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "cd /home/spoon/himiko-bot && npm install"

echo Deploying slash commands...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "cd /home/spoon/himiko-bot && npm run deploy"

echo Update complete!
pause
