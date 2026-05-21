# branches

A local web dashboard for browsing your git repos and branches. No build step, no dependencies — just Node.js.

## Quick start

```bash
git clone https://github.com/awilliamsbuilds/branches
cd branches
node branches.js ~/path/to/your/projects
```

No `npm install` needed — zero dependencies.

## What it does

- Lists all git repos in a directory
- Shows branches with ahead/behind status, author, and last commit
- Expands a branch to show commits, changed files, and linked PR (if you have `gh` installed)
- Refresh button re-fetches from remotes

## Requirements

- Node.js 18+
- `git`
- `gh` CLI _(optional — enables PR status in branch detail)_

## Usage

```bash
# Point it at a directory full of git repos
node branches.js ~/code/my-projects

# Opens at http://localhost:7799
```

If you don't pass a path it defaults to `~/Development`.

## Run on startup (macOS)

Use a launchd agent to start the app at login and keep it running.

1. **Clone the repo** to `~/Development/branches` (or update the paths below to match your location).

2. **Create the plist** at `~/Library/LaunchAgents/com.adam.branches.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.adam.branches</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/node</string>
        <string>/Users/YOUR_USERNAME/Development/branches/branches.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/Library/Logs/branches.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/Library/Logs/branches.log</string>
</dict>
</plist>
```

Replace `YOUR_USERNAME` with your macOS username, and update the Node.js path if needed (`which node` to check).

3. **Load the agent:**

```bash
launchctl load ~/Library/LaunchAgents/com.adam.branches.plist
```

The app will now start automatically at login and restart if it crashes. Logs go to `~/Library/Logs/branches.log`.

**To reload after pulling updates:**

```bash
launchctl unload ~/Library/LaunchAgents/com.adam.branches.plist
launchctl load ~/Library/LaunchAgents/com.adam.branches.plist
```
