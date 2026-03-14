@echo off
cd /d "C:\Users\Tablespoon\Desktop\spoon-bot"

git diff --quiet && git diff --cached --quiet
if errorlevel 1 (
  echo ERROR: Uncommitted changes detected. Commit first, then re-run.
  git status --short
  pause
  exit /b 1
)

echo Pushing to GitHub...
git push
if errorlevel 1 ( echo PUSH FAILED & pause & exit /b 1 )

echo Pulling on server...
plink -batch -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "cd /home/spoon/spoon-bot && git pull"
if errorlevel 1 ( echo PULL FAILED & pause & exit /b 1 )

echo Restarting bots...
plink -batch -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "bash -c 'pkill -f [t]s-node; tmux kill-server 2>/dev/null; sleep 1; exit 0'"
plink -batch -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "cd /home/spoon/spoon-bot && tmux new-session -d -s himiko 'npm run dev >> bot.log 2>&1' && tmux new-session -d -s snek 'bash -c \"set -a; source /home/spoon/spoon-bot/.env.snek; set +a; cd /home/spoon/spoon-bot; npx ts-node src/index.ts >> snek.log 2>&1\"'"
if errorlevel 1 ( echo RESTART FAILED & pause & exit /b 1 )

echo Waiting for startup...
timeout /t 6 /nobreak >nul

plink -batch -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "echo '=== himiko ===' && tail -4 /home/spoon/spoon-bot/bot.log && echo '=== snek ===' && tail -4 /home/spoon/spoon-bot/snek.log"

echo.
echo Update complete!
pause
