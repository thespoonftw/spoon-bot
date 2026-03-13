@echo off
echo Pushing to GitHub...
cd /d "C:\Users\Tablespoon\Desktop\himiko-bot"
git push

echo Stopping bot...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "pkill -f 'ts-node src/index.ts' || true"

echo Pulling latest code on server...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "cd /home/spoon/himiko-bot-new && git pull"

echo Installing dependencies...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "cd /home/spoon/himiko-bot-new && npm install"

echo Deploying slash commands...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "cd /home/spoon/himiko-bot-new && npm run deploy"

echo Update complete!
pause
