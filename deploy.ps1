param([switch]$Full)

$ErrorActionPreference = "Stop"
$plink = "C:\Program Files\PuTTY\plink.exe"
$conn = @("-batch", "-pw", "Omega1314", "-hostkey", "f5:db:e8:20:b7:b2:dc:91:6a:c2:ab:b3:cc:40:0a:e0", "spoon@192.168.1.50")

Set-Location $PSScriptRoot

$status = git status --porcelain
if ($status) { Write-Error "Uncommitted changes: $status"; exit 1 }

Write-Host "Pushing to GitHub..."
git push

if ($Full) {
    Write-Host "Running npm install and deploy on server..."
    & $plink @conn "cd /home/spoon/spoon-bot && git pull && npm install && npm run deploy && (set -a; source .env.snek; set +a; npm run deploy)"
} else {
    Write-Host "Pulling on server and installing dependencies..."
    & $plink @conn "cd /home/spoon/spoon-bot && git pull && npm install --silent"
}

Write-Host "Building web app..."
& $plink @conn "cd /home/spoon/spoon-bot/web && npm install --silent && npm run build"

Write-Host "Restarting bots..."
& $plink @conn "bash -c 'pkill -9 -f [t]s-node 2>/dev/null; tmux kill-server 2>/dev/null; sleep 2; lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 2; lsof -ti:3000 | xargs kill -9 2>/dev/null; sleep 1; exit 0'"
& $plink @conn "cd /home/spoon/spoon-bot && tmux new-session -d -s himiko 'npm run dev >> bot.log 2>&1' && tmux new-session -d -s snek 'bash -c \`"set -a; source /home/spoon/spoon-bot/.env.snek; set +a; cd /home/spoon/spoon-bot; npx ts-node src/index.ts >> snek.log 2>&1\`"'"

Write-Host "Waiting for startup..."
Start-Sleep 6

& $plink @conn "echo '=== himiko ===' && tail -4 /home/spoon/spoon-bot/bot.log && echo '=== snek ===' && tail -4 /home/spoon/spoon-bot/snek.log"
