Start or restart the git branch dashboard app.

Run this command:

```bash
if launchctl list com.adam.git-dashboard 2>/dev/null | grep -q '"PID"'; then
  launchctl kickstart -k gui/$(id -u)/com.adam.git-dashboard
else
  pkill -f "node.*git-dashboard.js" 2>/dev/null; node git-dashboard.js &
fi
```

After starting, tell the user the dashboard is running and they can open it at http://localhost:7799.
