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

echo Building web...
plink -batch -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "cd /home/spoon/spoon-bot/web && npm install --silent && npm run build 2>&1 | tail -4"
if errorlevel 1 ( echo WEB BUILD FAILED & pause & exit /b 1 )

echo Restarting bots...
plink -batch -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "systemctl --user restart himiko snek"
if errorlevel 1 ( echo RESTART FAILED & pause & exit /b 1 )

echo Waiting for startup...
ping -n 9 127.0.0.1 >nul

plink -batch -pw Omega1314 -hostkey "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0" spoon@192.168.1.50 "systemctl --user status himiko snek --no-pager | grep -E 'Active|Main PID'"

echo.
echo Update complete!
pause
