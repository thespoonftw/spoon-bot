@echo off
echo Pushing to GitHub...
cd /d "C:\Users\Tablespoon\Desktop\himiko-bot"
git push

echo Updating and restarting on server...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "tmux kill-session -t himiko 2>/dev/null || true; cd /home/spoon/spoon-bot && git pull && npm install && npm run deploy && tmux new-session -d -s himiko 'npm run dev >> bot.log 2>&1' && sleep 5 && tail -5 bot.log"

echo Update complete!
