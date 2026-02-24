---
name: setup-macmini-24x7
description: Keep a Mac mini running 24/7 for NanoClaw by preventing sleep (caffeinate via LaunchAgent/LaunchDaemon) and verifying power settings. Use when user says "mac mini", "no sleep", "headless", "24/7", or "caffeinate".
---

# Setup Mac mini 24/7 (No Sleep)

Goal: prevent the host Mac from sleeping so NanoClaw containers can run reliably.

## 1) Verify Current Power Settings

```bash
pmset -g custom
pmset -g assertions | head -n 80
```

## 2) Create a LaunchAgent (user session)

This is usually enough for a headless Mac mini that stays logged in.

Create `~/Library/LaunchAgents/local.caffeinate.nanoclaw.plist`:

```bash
cat > ~/Library/LaunchAgents/local.caffeinate.nanoclaw.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>local.caffeinate.nanoclaw</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/bin/caffeinate</string>
      <string>-dimsu</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
  </dict>
</plist>
EOF
```

Load it:

```bash
uid=$(id -u)
plist="$HOME/Library/LaunchAgents/local.caffeinate.nanoclaw.plist"
launchctl bootout "gui/$uid" "$plist" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$uid" "$plist"
launchctl kickstart -k "gui/$uid/local.caffeinate.nanoclaw"
```

## 3) Verify It's Working

```bash
pmset -g assertions | rg -n "caffeinate|PreventUserIdleSystemSleep|PreventSystemSleep" || true
launchctl list | rg -n "local\\.caffeinate\\.nanoclaw" || true
```

## Notes

- Use LaunchDaemon only if you need this even before login (requires sudo + writing to `/Library/LaunchDaemons/`).
- Don’t disable display sleep unless you actually need it; `-d` in `caffeinate -dimsu` prevents display sleep too.

