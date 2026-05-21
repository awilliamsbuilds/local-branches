Start or restart the Branches app.

Run this command:

```bash
if launchctl list com.adam.branches 2>/dev/null | grep -q '"PID"'; then
  launchctl kickstart -k gui/$(id -u)/com.adam.branches
else
  launchctl load ~/Library/LaunchAgents/com.adam.branches.plist
fi
```

After starting, tell the user Branches is running and they can open it at http://localhost:7799.
