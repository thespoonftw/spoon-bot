@echo off
echo Pushing to GitHub...
cd /d "C:\Users\Tablespoon\Desktop\himiko-bot"
git push

echo Updating and restarting on server...
plink -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "tmux kill-session -t himiko 2>/dev/null || true; tmux kill-session -t snek 2>/dev/null || true; cd /home/spoon/spoon-bot && git pull && npm install && npm run deploy && (set -a; source .env.snek; set +a; npm run deploy) && tmux new-session -d -s himiko 'npm run dev >> bot.log 2>&1' && tmux new-session -d -s snek 'bash -c \"set -a; source /home/spoon/spoon-bot/.env.snek; set +a; cd /home/spoon/spoon-bot; npx ts-node src/index.ts >> snek.log 2>&1\"' && sleep 5 && echo '=== himiko ===' && tail -3 bot.log && echo '=== snek ===' && tail -3 snek.log"

echo Update complete!
