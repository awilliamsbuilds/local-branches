# local-branches — Git Dashboard

Single-file Node.js app (`git-dashboard.js`) that serves a local web dashboard for browsing git branches across all repos in `~/Documents/GitHub`.

## Stack
- Pure Node.js, no npm dependencies — uses only built-ins (`http`, `child_process`, `fs`, `zlib`)
- All HTML/CSS/JS is embedded as a template string in `git-dashboard.js`
- Served at http://localhost:7799

## Running locally
The app is managed by a launchd agent (`com.adam.git-dashboard`) that starts at login and auto-restarts on crash. Use `/git-dashboard` to restart it after changes.

## After merging a PR
After every PR merge in this repo, always ask the user:
> "Want me to restart the git dashboard so it picks up the changes? (`/git-dashboard`)"

If they say yes, run `/git-dashboard`.
