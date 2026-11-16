#!/bin/bash
PLIST="$HOME/Library/LaunchAgents/app.luka.hand.plist"
launchctl unload "$PLIST" 2>/dev/null
rm -f "$PLIST"
rm -rf "$HOME/.luka"
echo "היד של לוקה הוסרה מהמחשב."
