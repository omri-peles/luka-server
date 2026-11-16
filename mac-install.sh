#!/bin/bash
# Installs "Luka's hand" on this Mac. Remove any time with:
#   curl -fsSL __SERVER__/mac/uninstall.sh | bash
set -e
SERVER="__SERVER__"
DIR="$HOME/.luka"
PLIST="$HOME/Library/LaunchAgents/app.luka.hand.plist"
mkdir -p "$DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$DIR"
echo "$SERVER" > "$DIR/server"

if [ ! -s "$DIR/token" ]; then
  echo "שולח קוד חיבור לוואטסאפ שלך..."
  curl -fsS -X POST "$SERVER/pair/request" >/dev/null || { echo "לא הצלחתי לשלוח קוד. חכה דקה והרץ שוב."; exit 1; }
  printf "הקלד את 6 הספרות שקיבלת ולחץ Enter: "
  read -r CODE < /dev/tty
  TOKEN="$(curl -fsS -X POST "$SERVER/pair/confirm" --data-urlencode "code=$CODE" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
  [ -z "$TOKEN" ] && { echo "הקוד שגוי או שפג תוקפו. הרץ שוב את הפקודה."; exit 1; }
  ( umask 077; echo "$TOKEN" > "$DIR/token" )
fi

curl -fsS "$SERVER/mac/agent.sh" -o "$DIR/agent.sh"
chmod 700 "$DIR/agent.sh"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>app.luka.hand</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/agent.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>$DIR/agent.log</string>
  <key>StandardErrorPath</key><string>$DIR/agent.log</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo ""
echo "הותקן. היד של לוקה פועלת ברקע ותעלה לבד בכל הדלקה של המחשב."
echo "אם קופצת עכשיו שאלה של המק לגבי שליטה ב-Google Chrome, אשר אותה."
