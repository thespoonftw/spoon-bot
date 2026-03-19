@echo off
echo Full update: installs packages and re-registers slash commands.
echo Use this when package.json or deploy-commands.ts changed.
echo For normal code changes, use update-spoonbot-server.bat instead.
echo.
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

echo Running full update on server...
plink -batch -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "cd /home/spoon/spoon-bot && git pull && npm install && cd web && npm install && npm run build && cd .. && npm run deploy && (set -a; source .env.snek; set +a; npm run deploy)"
if errorlevel 1 ( echo FULL UPDATE FAILED & pause & exit /b 1 )

echo Restarting bots...
plink -batch -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "systemctl --user restart himiko snek"
if errorlevel 1 ( echo RESTART FAILED & pause & exit /b 1 )

echo Waiting for startup...
plink -batch -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "ping -c 6 127.0.0.1 > /dev/null && systemctl --user status himiko snek | grep -E 'Active|Main PID'"

echo.
echo Full update complete!
pause
