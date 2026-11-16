#!/bin/bash
# Luka's hand on the Mac. Runs in the background and carries out a fixed, short list of
# actions that Luka asks for: open a web address, close Chrome tabs by name, open an app,
# set the volume. It cannot run arbitrary commands and it never updates itself.
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
DIR="$HOME/.luka"
SERVER="$(cat "$DIR/server" 2>/dev/null)"
TOKEN="$(cat "$DIR/token" 2>/dev/null)"
[ -z "$SERVER" ] || [ -z "$TOKEN" ] && { echo "missing server or token"; sleep 30; exit 1; }

answer() {  # id, text
  /usr/bin/curl -fsS --max-time 10 -X POST "$SERVER/mac/result" -H "x-luka-token: $TOKEN" \
    --data-urlencode "id=$1" --data-urlencode "text=$2" >/dev/null 2>&1
}

chrome_running() { /usr/bin/pgrep -x "Google Chrome" >/dev/null 2>&1; }

close_tabs() {  # what
  chrome_running || { echo "לא נסגר דבר: כרום לא פתוח במחשב."; return; }
  /usr/bin/osascript - "$1" <<'APPLESCRIPT' 2>&1
on matches(hay, ws)
  ignoring case
    repeat with x in ws
      set xt to x as text
      if (length of xt) > 0 then
        if hay does not contain xt then return false
      end if
    end repeat
  end ignoring
  return true
end matches

on run argv
  set q to item 1 of argv
  set closedNames to {}
  set openNames to {}
  set AppleScript's text item delimiters to " "
  set ws to text items of q
  tell application "Google Chrome"
    if q is "current" then
      if (count of windows) is 0 then return "לא נסגר דבר: אין חלון פתוח בכרום."
      set t to active tab of front window
      set u to URL of t
      if u contains "railway.app" then return "לא נסגר: הלשונית הפעילה היא של לוקה עצמה."
      set ttl to title of t
      close t
      return "נסגרה הלשונית: " & ttl
    end if
    repeat with w in (every window)
      set n to count of tabs of w
      repeat with i from n to 1 by -1
        set t to tab i of w
        set ttl to title of t
        set u to URL of t
        if u does not contain "railway.app" then
          if my matches(ttl & " " & u, ws) then
            set end of closedNames to ttl
            close t
          else
            if (count of openNames) < 12 then set end of openNames to ttl
          end if
        end if
      end repeat
    end repeat
  end tell
  set AppleScript's text item delimiters to " | "
  if (count of closedNames) > 0 then
    return "נסגרו " & (count of closedNames) & " לשוניות: " & (closedNames as text)
  else
    return "לא נסגר דבר: לא נמצאה לשונית שמתאימה ל-" & q & ". הלשוניות הפתוחות: " & (openNames as text)
  end if
end run
APPLESCRIPT
}

handle() {  # type, a1, a2
  case "$1" in
    open)
      case "$2" in
        http://*|https://*) /usr/bin/open "$2" && echo "נפתח במחשב: ${3:-$2}" || echo "לא נפתח: המחשב לא הצליח לפתוח את הכתובת." ;;
        *) echo "לא נפתח: כתובת לא תקינה." ;;
      esac ;;
    close) close_tabs "$2" ;;
    app)
      if [[ "$2" =~ ^[A-Za-z0-9\ ._-]{1,40}$ ]]; then
        /usr/bin/open -a "$2" 2>/dev/null && echo "נפתחה האפליקציה $2." || echo "לא נפתח: לא נמצאה במחשב אפליקציה בשם $2."
      else echo "לא נפתח: שם אפליקציה לא תקין."; fi ;;
    volume)
      if [[ "$2" =~ ^[0-9]{1,3}$ ]] && [ "$2" -le 100 ]; then
        /usr/bin/osascript -e "set volume output volume $2" >/dev/null 2>&1 && echo "עוצמת הקול במחשב נקבעה ל-$2 אחוז." || echo "לא בוצע: לא הצלחתי לשנות את עוצמת הקול."
      else echo "לא בוצע: עוצמה לא תקינה."; fi ;;
    *) echo "לא בוצע: פעולה לא מוכרת." ;;
  esac
}

# Ask macOS once, right at start, for permission to control Chrome (harmless read).
chrome_running && /usr/bin/osascript -e 'tell application "Google Chrome" to count windows' >/dev/null 2>&1

while true; do
  OUT="$(/usr/bin/curl -fsS --max-time 35 "$SERVER/mac/next" -H "x-luka-token: $TOKEN" 2>/dev/null)"
  RC=$?
  if [ $RC -ne 0 ]; then
    CODE="$(/usr/bin/curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SERVER/mac/next?probe=1" -H "x-luka-token: $TOKEN" 2>/dev/null)"
    [ "$CODE" = "401" ] && { echo "token rejected; run the installer again"; sleep 300; }
    sleep 5; continue
  fi
  [ -z "$OUT" ] && continue
  while IFS=$'\t' read -r id type a1 a2; do
    [ -z "$id" ] && continue
    RES="$(handle "$type" "$a1" "$a2" | /usr/bin/head -c 900)"
    answer "$id" "${RES:-לא התקבלה תוצאה מהמחשב.}"
  done <<< "$OUT"
done
