#!/bin/bash
# Luka's hand on the Mac. Runs in the background and carries out a fixed, short list of
# actions that Luka asks for: open a web address, close Chrome tabs by name, open an app,
# set the volume, control music playback, turn the display off, and work with files only inside
# Desktop, Documents and Downloads: find by name, read text/Word, open, create a NEW text file
# (never overwrites), and move a file to the Trash. It cannot run arbitrary commands and it
# never updates itself. It can also take one picture of the screen when Luka is asked to look at it,
# and it refuses to read files that hold keys or passwords.
# Version 5 adds, at the owner's request: keyboard (type text, press keys), quitting an app, a status
# report of the computer, sleep, working in Chrome (list tabs, go to an address, read the page, click by
# text, fill a field; never password or card fields), and running a terminal command. A command is sent
# here only after the owner said yes out loud to that exact command; sudo and Luka's own folder are refused.
# Version 6 adds: a mouse click at a point on the main screen, making a folder and moving a file (inside Desktop,
# Documents and Downloads only, never over an existing file), locking the screen, and three things that are sent
# here only after the owner said yes out loud: downloading a file into Downloads (it is never opened or run),
# restarting and shutting down.
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

safe_path() {  # prints the real path of a file inside Desktop / Documents / Downloads, or nothing
  local rel="$1"
  case "$rel" in *..*|/*) return 1 ;; esac
  case "$rel" in Desktop/*|Documents/*|Downloads/*) ;; *) return 1 ;; esac
  local f="$HOME/$rel"
  [ -f "$f" ] && [ ! -L "$f" ] || return 1
  local real; real="$(cd "$(/usr/bin/dirname "$f")" 2>/dev/null && pwd -P)/$(/usr/bin/basename "$f")"
  case "$real" in "$HOME/Desktop/"*|"$HOME/Documents/"*|"$HOME/Downloads/"*) printf '%s' "$real" ;; *) return 1 ;; esac
}
write_file() {  # new text file only (never overwrites); content arrives base64-encoded
  local rel="$1"
  case "$rel" in *..*|/*) echo "לא נכתב: נתיב לא תקין."; return ;; esac
  case "$rel" in Desktop/*|Documents/*|Downloads/*) ;; *) echo "לא נכתב: אפשר לכתוב רק לתוך Desktop, Documents או Downloads."; return ;; esac
  case "$(printf '%s' "$rel" | /usr/bin/tr 'A-Z' 'a-z')" in *.txt|*.md|*.csv|*.json|*.html|*.xml|*.js|*.ts|*.jsx|*.tsx|*.py|*.sh|*.rb|*.php|*.java|*.c|*.h|*.cpp|*.go|*.rs|*.swift|*.kt|*.sql|*.yaml|*.yml|*.toml|*.css) ;; *) echo "לא נכתב: סוג הקובץ לא נתמך. אפשר ליצור קובצי טקסט וקוד."; return ;; esac
  local f="$HOME/$rel"
  [ -d "$(/usr/bin/dirname "$f")" ] || { echo "לא נכתב: התיקייה לא קיימת."; return; }
  [ -e "$f" ] && { echo "לא נכתב: כבר קיים קובץ בשם הזה, ואיני דורסת קבצים."; return; }
  printf '%s' "$2" | /usr/bin/base64 -D > "$f" 2>/dev/null && echo "הקובץ נוצר: $rel" || { /bin/rm -f "$f"; echo "לא נכתב: שגיאה בכתיבה."; }
}
trash_file() {  # moves a file to the Trash through Finder, so it can be put back
  local real; real="$(safe_path "$1")" || { echo "לא הועבר לאשפה: הקובץ לא נמצא או מחוץ לתיקיות המותרות."; return; }
  /usr/bin/osascript - "$real" >/dev/null 2>&1 <<'APPLESCRIPT' && echo "הקובץ הועבר לאשפה: $1 (אפשר לשחזר אותו מהאשפה)." || echo "לא הועבר לאשפה: המק לא אישר, או שחסרה הרשאה לשלוט ב-Finder."
on run argv
  tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)
end run
APPLESCRIPT
}
media() {  # play | pause | playpause | next | previous, in Spotify or Music (whichever is open)
  local app=""
  /usr/bin/pgrep -x "Spotify" >/dev/null 2>&1 && app="Spotify"
  [ -z "$app" ] && /usr/bin/pgrep -x "Music" >/dev/null 2>&1 && app="Music"
  [ -z "$app" ] && { echo "לא בוצע: ספוטיפיי ומיוזיק לא פתוחים במחשב."; return; }
  local cmd=""
  case "$1" in play) cmd="play" ;; pause) cmd="pause" ;; playpause) cmd="playpause" ;; next) cmd="next track" ;; previous) cmd="previous track" ;; *) echo "לא בוצע: פעולה לא מוכרת."; return ;; esac
  /usr/bin/osascript -e "tell application \"$app\" to $cmd" >/dev/null 2>&1 && echo "בוצע ב-$app: $1." || echo "לא בוצע: המק לא אישר שליטה ב-$app."
}

read_file() {  # path relative to the home folder, only inside Desktop / Documents / Downloads; read-only
  local rel="$1"
  case "$rel" in *..*|/*) echo "לא נקרא: נתיב לא תקין."; return ;; esac
  case "$rel" in Desktop/*|Documents/*|Downloads/*) ;; *) echo "לא נקרא: אפשר לקרוא רק מתוך Desktop, Documents או Downloads."; return ;; esac
  local f="$HOME/$rel"
  [ -f "$f" ] || { echo "לא נקרא: הקובץ לא נמצא."; return; }
  [ -L "$f" ] && { echo "לא נקרא: זה קיצור דרך ולא קובץ."; return; }
  local real; real="$(cd "$(/usr/bin/dirname "$f")" 2>/dev/null && pwd -P)/$(/usr/bin/basename "$f")"
  case "$real" in "$HOME/Desktop/"*|"$HOME/Documents/"*|"$HOME/Downloads/"*) ;; *) echo "לא נקרא: הקובץ מחוץ לתיקיות המותרות."; return ;; esac
  local lower; lower="$(printf '%s' "$rel" | /usr/bin/tr 'A-Z' 'a-z')"
  case "$lower" in
    *.pem|*.key|*.p12|*id_rsa*|*.env|*.env.*|*/.*) echo "לא נקרא: זה קובץ של מפתחות או סודות, ואיני קוראת קבצים כאלה." ;;
    *.txt|*.md|*.csv|*.json|*.html|*.xml|*.log|*.js|*.ts|*.jsx|*.tsx|*.py|*.sh|*.rb|*.php|*.java|*.c|*.h|*.cpp|*.go|*.rs|*.swift|*.kt|*.sql|*.yaml|*.yml|*.toml|*.css) /usr/bin/head -c 20000 "$real" ;;
    *.docx|*.doc|*.rtf|*.odt) /usr/bin/textutil -convert txt -stdout "$real" 2>/dev/null | /usr/bin/head -c 12000 ;;
    *) echo "לא נקרא: סוג הקובץ לא נתמך. נתמכים קובצי טקסט, קוד, CSV, Word ו-RTF." ;;
  esac
}

b64() { printf '%s' "$1" | /usr/bin/base64 -D 2>/dev/null; }
NEED_AX="לא בוצע: המק לא מרשה לי להקיש. צריך לאשר ל-bash גישה ב'הגדרות המערכת > פרטיות ואבטחה > נגישות'."
type_text() {  # pastes the text into whatever window is in front (keeps Hebrew intact); puts the clipboard back afterwards
  local t; t="$(b64 "$1")"; [ -z "$t" ] && { echo "לא בוצע: אין טקסט."; return; }
  local old; old="$(/usr/bin/pbpaste 2>/dev/null)"
  printf '%s' "$t" | /usr/bin/pbcopy
  if /usr/bin/osascript -e 'tell application "System Events" to keystroke "v" using command down' >/dev/null 2>&1; then
    sleep 0.4; printf '%s' "$old" | /usr/bin/pbcopy; echo "הטקסט הוקלד בחלון הפעיל."
  else printf '%s' "$old" | /usr/bin/pbcopy; echo "$NEED_AX"; fi
}
press_keys() {  # e.g. enter, tab, cmd+w, cmd+shift+t, ctrl+cmd+f
  /usr/bin/osascript - "$1" <<'APPLESCRIPT' 2>/dev/null || echo "$NEED_AX"
on run argv
  set combo to item 1 of argv
  set AppleScript's text item delimiters to "+"
  set parts to text items of combo
  set k to last item of parts
  set mods to {}
  repeat with i from 1 to (count of parts) - 1
    set m to (item i of parts) as text
    if m is "cmd" then set end of mods to command down
    if m is "shift" then set end of mods to shift down
    if m is "alt" then set end of mods to option down
    if m is "ctrl" then set end of mods to control down
  end repeat
  set codes to {{"enter", 36}, {"tab", 48}, {"space", 49}, {"delete", 51}, {"escape", 53}, {"left", 123}, {"right", 124}, {"down", 125}, {"up", 126}, {"home", 115}, {"end", 119}, {"pageup", 116}, {"pagedown", 121}, {"f11", 103}}
  tell application "System Events"
    repeat with c in codes
      if (item 1 of c) is k then
        key code (item 2 of c) using mods
        return "הוקש: " & combo
      end if
    end repeat
    if (length of k) is 1 then
      keystroke k using mods
      return "הוקש: " & combo
    end if
  end tell
  return "לא בוצע: מקש לא מוכר."
end run
APPLESCRIPT
}
stats() {
  echo "מעבד וזיכרון: $(/usr/bin/top -l 1 -n 0 2>/dev/null | /usr/bin/grep -E 'CPU usage|PhysMem' | /usr/bin/tr '\n' ' ')"
  echo "דיסק: $(/bin/df -h / 2>/dev/null | /usr/bin/tail -1 | /usr/bin/awk '{print "בשימוש " $3 " מתוך " $2 ", פנוי " $4}')"
  echo "סוללה: $(/usr/bin/pmset -g batt 2>/dev/null | /usr/bin/grep -Eo '[0-9]+%.*' | /usr/bin/head -1)"
  echo "פועל מאז: $(/usr/bin/uptime 2>/dev/null | /usr/bin/sed 's/.*up \([^,]*\),.*/\1/')"
  echo "האפליקציות הכבדות: $(/bin/ps -Aceo pcpu,comm -r 2>/dev/null | /usr/bin/head -6 | /usr/bin/tail -5 | /usr/bin/awk '{printf "%s %s%%, ", $2, $1}')"
}
run_shell() {  # the owner approved this exact command out loud before it was sent
  local c; c="$(b64 "$1")"; [ -z "$c" ] && { echo "לא בוצע: אין פקודה."; return; }
  case "$c" in *sudo*|*.luka*|*launchctl*|*csrutil*|*spctl*|*"security "*|*.ssh*|*keychain*|*Keychain*) echo "לא בוצע: הפקודה נוגעת בהרשאות, בסודות או בעוזר עצמו, ואיני מריצה פקודות כאלה."; return ;; esac
  ( cd "$HOME" && /bin/bash -c "$c" 2>&1 & PID=$!; ( sleep 30; /bin/kill -9 $PID 2>/dev/null ) & W=$!; wait $PID 2>/dev/null; echo "[קוד סיום: $?]"; /bin/kill $W 2>/dev/null ) | /usr/bin/head -c 6000
}
chrome_do() {  # tabs | goto URL | js BASE64-JSON-ARGS   (acts on the front tab that is not Luka's own page)
  chrome_running || { echo "לא בוצע: כרום לא פתוח במחשב."; return; }
  /usr/bin/osascript - "$1" "$2" <<'APPLESCRIPT' 2>&1
on targetTab()
  tell application "Google Chrome"
    repeat with w in (every window)
      set t to active tab of w
      if (URL of t) does not contain "railway.app" then return t
    end repeat
  end tell
  return missing value
end targetTab
on run argv
  set act to item 1 of argv
  set arg to item 2 of argv
  tell application "Google Chrome"
    if act is "tabs" then
      set out to ""
      repeat with w in (every window)
        repeat with t in (every tab of w)
          if (URL of t) does not contain "railway.app" then set out to out & (title of t) & " | " & (URL of t) & linefeed
        end repeat
      end repeat
      if out is "" then return "אין לשוניות פתוחות בכרום."
      return out
    end if
    set t to my targetTab()
    if t is missing value then return "לא בוצע: אין בכרום לשונית פתוחה מלבד לוקה."
    if act is "goto" then
      set URL of t to arg
      return "הלשונית עברה אל: " & arg
    end if
    if act is "js" then
      try
        return (execute t javascript arg) as text
      on error e
        return "לא בוצע: כרום לא מרשה לי לפעול בתוך הדף. צריך לסמן בכרום בתפריט 'תצוגה > מפתחים > אפשר JavaScript מאירועי Apple'. (" & e & ")"
      end try
    end if
  end tell
  return "לא בוצע."
end run
APPLESCRIPT
}
# The page actions are fixed pieces of code; only their data (text to find, value to fill) comes from Luka, as base64.
JS_PRE='(function(){var d={};try{d=JSON.parse(decodeURIComponent(escape(atob("__B64__"))))}catch(e){};var vis=function(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0};var low=function(s){return String(s||"").replace(/\s+/g," ").trim().toLowerCase()};'
JS_READ='return (document.title+"\n"+location.href+"\n\n"+document.body.innerText).slice(0,9000)})()'
JS_CLICK='var q=low(d.text),best=null;var els=document.querySelectorAll("a,button,[role=button],[role=link],[role=tab],[role=menuitem],input[type=submit],input[type=button],summary,label");for(var i=0;i<els.length;i++){var e=els[i];if(!vis(e))continue;var t=low(e.innerText||e.value||e.getAttribute("aria-label")||e.title);if(!t)continue;if(t===q){best=e;break}if(!best&&t.indexOf(q)>=0&&t.length<q.length+60)best=e}if(!best)return "לא נמצא בדף כפתור או קישור עם הטקסט הזה.";best.scrollIntoView({block:"center"});best.click();return "נלחץ: "+low(best.innerText||best.value||best.getAttribute("aria-label")).slice(0,80)})()'
JS_FILL='var q=low(d.field),hit=null;var els=document.querySelectorAll("input,textarea,select");for(var i=0;i<els.length;i++){var e=els[i];if(!vis(e))continue;var ty=low(e.type);if(ty==="hidden"||ty==="submit"||ty==="button"||ty==="checkbox"||ty==="radio"||ty==="file")continue;var lab="";if(e.id){var l=document.querySelector("label[for=\""+e.id+"\"]");if(l)lab=l.innerText}if(!lab&&e.closest("label"))lab=e.closest("label").innerText;var names=low([lab,e.placeholder,e.getAttribute("aria-label"),e.name,e.id].join(" "));if(names.indexOf(q)>=0){hit=e;break}}if(!hit)return "לא נמצא בדף שדה מתאים.";var ac=low(hit.autocomplete);if(low(hit.type)==="password"||ac.indexOf("cc-")===0||/card|cvv|cvc|password|סיסמ|אשראי/.test(low([hit.name,hit.id,hit.placeholder].join(" "))))return "לא מולא: זה שדה של סיסמה או אמצעי תשלום, ואיני ממלאת שדות כאלה.";hit.focus();var proto=hit.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:hit.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(hit,String(d.value||""));hit.dispatchEvent(new Event("input",{bubbles:true}));hit.dispatchEvent(new Event("change",{bubbles:true}));return "השדה מולא."})()'
page_js() {  # which, base64-json
  [[ "$2" =~ ^[A-Za-z0-9+/=]*$ ]] || { echo "לא בוצע: נתונים לא תקינים."; return; }
  local body; case "$1" in read) body="$JS_READ" ;; click) body="$JS_CLICK" ;; fill) body="$JS_FILL" ;; *) echo "לא בוצע."; return ;; esac
  chrome_do js "${JS_PRE/__B64__/$2}$body"
}

click_at() {  # "0.52,0.31" = fractions of the main screen's width and height, as seen in the screenshot
  local fx="${1%%,*}" fy="${1##*,}"
  [[ "$fx" =~ ^0?\.[0-9]{1,4}$|^[01]$ ]] && [[ "$fy" =~ ^0?\.[0-9]{1,4}$|^[01]$ ]] || { echo "לא בוצע: נקודה לא תקינה."; return; }
  local size; size="$(/usr/bin/osascript -l JavaScript -e 'ObjC.import("AppKit"); var f = $.NSScreen.mainScreen.frame; Math.round(f.size.width) + "," + Math.round(f.size.height)' 2>/dev/null)"
  [[ "$size" =~ ^[0-9]+,[0-9]+$ ]] || { echo "לא בוצע: לא הצלחתי לקרוא את גודל המסך."; return; }
  local x y; x="$(/usr/bin/awk -v a="$fx" -v b="${size%%,*}" 'BEGIN{printf "%d", a*b}')"; y="$(/usr/bin/awk -v a="$fy" -v b="${size##*,}" 'BEGIN{printf "%d", a*b}')"
  /usr/bin/osascript -e "tell application \"System Events\" to click at {$x, $y}" >/dev/null 2>&1 && echo "נלחץ בנקודה $x,$y במסך." || echo "$NEED_AX"
}
allowed_dir() {  # prints the real path of an existing folder inside Desktop / Documents / Downloads, or nothing
  local rel="$1"
  case "$rel" in *..*|/*) return 1 ;; esac
  case "$rel" in Desktop|Documents|Downloads|Desktop/*|Documents/*|Downloads/*) ;; *) return 1 ;; esac
  [ -d "$HOME/$rel" ] && [ ! -L "$HOME/$rel" ] || return 1
  local real; real="$(cd "$HOME/$rel" 2>/dev/null && pwd -P)"
  case "$real" in "$HOME/Desktop"*|"$HOME/Documents"*|"$HOME/Downloads"*) printf '%s' "$real" ;; *) return 1 ;; esac
}
make_folder() {
  local rel="$1"
  case "$rel" in *..*|/*) echo "לא נוצר: נתיב לא תקין."; return ;; esac
  case "$rel" in Desktop/*|Documents/*|Downloads/*) ;; *) echo "לא נוצר: אפשר ליצור תיקיות רק בתוך Desktop, Documents או Downloads."; return ;; esac
  allowed_dir "$(/usr/bin/dirname "$rel")" >/dev/null || { echo "לא נוצר: התיקייה שמעליה לא קיימת."; return; }
  [ -e "$HOME/$rel" ] && { echo "כבר קיים שם פריט בשם הזה."; return; }
  /bin/mkdir "$HOME/$rel" 2>/dev/null && echo "התיקייה נוצרה: $rel" || echo "לא נוצר: שגיאה."
}
move_file() {  # file, destination folder
  local src; src="$(safe_path "$1")" || { echo "לא הועבר: הקובץ לא נמצא או מחוץ לתיקיות המותרות."; return; }
  local dst; dst="$(allowed_dir "$2")" || { echo "לא הועבר: תיקיית היעד לא קיימת או מחוץ לתיקיות המותרות."; return; }
  local name; name="$(/usr/bin/basename "$src")"
  [ -e "$dst/$name" ] && { echo "לא הועבר: בתיקיית היעד כבר יש קובץ בשם הזה, ואיני דורסת קבצים."; return; }
  /bin/mv -n "$src" "$dst/$name" 2>/dev/null && echo "הקובץ הועבר אל $2/$name" || echo "לא הועבר: שגיאה."
}
download_file() {  # url, file name. The owner approved this exact download out loud. The file is saved, never opened or run.
  local url="$1" name="$2"
  case "$url" in https://*) ;; *) echo "לא הורד: רק כתובות https."; return ;; esac
  [[ "$name" =~ ^[A-Za-z0-9._\ -]{1,80}$ ]] && [[ "$name" != .* ]] || { echo "לא הורד: שם קובץ לא תקין."; return; }
  [ -e "$HOME/Downloads/$name" ] && { echo "לא הורד: כבר יש בהורדות קובץ בשם הזה."; return; }
  if /usr/bin/curl -fsSL --max-time 180 --max-filesize 314572800 -o "$HOME/Downloads/$name" "$url" 2>/dev/null; then
    echo "הקובץ הורד אל Downloads/$name ($(/usr/bin/du -h "$HOME/Downloads/$name" | /usr/bin/awk '{print $1}')). לא פתחתי אותו."
  else /bin/rm -f "$HOME/Downloads/$name"; echo "לא הורד: ההורדה נכשלה, או שהקובץ גדול מ-300 מגה."; fi
}
KEYS_RE='^((cmd|shift|alt|ctrl)[+]){0,3}([a-z0-9,./=-]|enter|tab|space|delete|escape|left|right|up|down|home|end|pageup|pagedown|f11)$'
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
    find)
      if [ -z "$2" ]; then echo "לא בוצע: חסר מה לחפש."; else
        FOUND="$(/usr/bin/mdfind -name "$2" -onlyin "$HOME/Desktop" -onlyin "$HOME/Documents" -onlyin "$HOME/Downloads" 2>/dev/null | /usr/bin/head -n 15 | /usr/bin/sed "s|^$HOME/||")"
        [ -z "$FOUND" ] && echo "לא נמצאו קבצים בשם הזה בשולחן העבודה, במסמכים או בהורדות." || echo "$FOUND"
      fi ;;
    read) read_file "$2" ;;
    write) write_file "$2" "$3" ;;
    trash) trash_file "$2" ;;
    openfile) REAL="$(safe_path "$2")" && /usr/bin/open "$REAL" && echo "הקובץ נפתח במחשב: $2" || echo "לא נפתח: הקובץ לא נמצא או מחוץ לתיקיות המותרות." ;;
    media) media "$2" ;;
    screen)   # one picture of the screen, sent to Luka only when she is asked to look
      SHOT="$DIR/screen.jpg"; /bin/rm -f "$SHOT"
      /usr/sbin/screencapture -x -t jpg "$SHOT" >/dev/null 2>&1
      if [ -s "$SHOT" ]; then
        /usr/bin/sips -Z 1568 -s formatOptions 60 "$SHOT" >/dev/null 2>&1
        /usr/bin/curl -fsS --max-time 20 -X POST "$SERVER/camera/frame" -H "x-luka-token: $TOKEN" -H "x-frame-id: $2" -H "content-type: image/jpeg" --data-binary "@$SHOT" >/dev/null 2>&1 && echo "צילום המסך נשלח." || echo "לא הצלחתי לשלוח את צילום המסך."
        /bin/rm -f "$SHOT"
      else
        /usr/bin/curl -fsS --max-time 10 -X POST "$SERVER/camera/frame" -H "x-luka-token: $TOKEN" -H "x-frame-id: $2" -H "x-frame-error: 1" -H "content-type: image/jpeg" --data-binary "x" >/dev/null 2>&1
        echo "לא הצלחתי לצלם את המסך. צריך לאשר הקלטת מסך בהגדרות המק."
      fi ;;
    stats) stats ;;
    type) type_text "$3" ;;
    keys) if [[ "$2" =~ $KEYS_RE ]]; then press_keys "$2"; else echo "לא בוצע: צירוף מקשים לא תקין."; fi ;;
    quit)
      if [[ "$2" =~ ^[A-Za-z0-9\ ._-]{1,40}$ ]]; then
        /usr/bin/osascript -e "tell application \"$2\" to quit" >/dev/null 2>&1 && echo "האפליקציה $2 נסגרה." || echo "לא נסגר: לא נמצאה אפליקציה פתוחה בשם $2."
      else echo "לא נסגר: שם אפליקציה לא תקין."; fi ;;
    click) click_at "$2" ;;
    mkdir) make_folder "$2" ;;
    move) move_file "$2" "$3" ;;
    download) download_file "$2" "$3" ;;
    lock) /usr/bin/osascript -e 'tell application "System Events" to keystroke "q" using {control down, command down}' >/dev/null 2>&1 && echo "המסך ננעל." || echo "$NEED_AX" ;;
    power)
      case "$2" in
        restart) echo "המחשב מופעל מחדש."; ( sleep 3; /usr/bin/osascript -e 'tell application "System Events" to restart' >/dev/null 2>&1 ) & ;;
        shutdown) echo "המחשב נכבה."; ( sleep 3; /usr/bin/osascript -e 'tell application "System Events" to shut down' >/dev/null 2>&1 ) & ;;
        *) echo "לא בוצע." ;;
      esac ;;
    sleep) echo "המחשב עובר למצב שינה."; ( sleep 2; /usr/bin/pmset sleepnow >/dev/null 2>&1 ) & ;;
    shell) run_shell "$3" ;;
    tabs) chrome_do tabs - ;;
    goto) case "$2" in http://*|https://*) chrome_do goto "$2" ;; *) echo "לא בוצע: כתובת לא תקינה." ;; esac ;;
    pageread) page_js read "" ;;
    pageclick) page_js click "$3" ;;
    pagefill) page_js fill "$3" ;;
    displaysleep) /usr/bin/pmset displaysleepnow >/dev/null 2>&1 && echo "המסך של המחשב כובה." || echo "לא בוצע." ;;
    *) echo "לא בוצע: פעולה לא מוכרת." ;;
  esac
}

# Ask macOS once, right at start, for permission to control Chrome (harmless read).
chrome_running && /usr/bin/osascript -e 'tell application "Google Chrome" to count windows' >/dev/null 2>&1

while true; do
  OUT="$(/usr/bin/curl -fsS --max-time 35 "$SERVER/mac/next" -H "x-luka-token: $TOKEN" -H "x-luka-helper: 6" 2>/dev/null)"
  RC=$?
  if [ $RC -ne 0 ]; then
    CODE="$(/usr/bin/curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SERVER/mac/next?probe=1" -H "x-luka-token: $TOKEN" 2>/dev/null)"
    [ "$CODE" = "401" ] && { echo "token rejected; run the installer again"; sleep 300; }
    sleep 5; continue
  fi
  [ -z "$OUT" ] && continue
  while IFS=$'\t' read -r id type a1 a2; do
    [ -z "$id" ] && continue
    RES="$(handle "$type" "$a1" "$a2" | /usr/bin/head -c 12000)"
    answer "$id" "${RES:-לא התקבלה תוצאה מהמחשב.}"
  done <<< "$OUT"
done
