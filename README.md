# local-branches

A local web dashboard for browsing your git repos and branches. No build step, no dependencies — just Node.js.

![screenshot placeholder](https://via.placeholder.com/600x400)

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
node git-dashboard.js ~/code/my-projects

# Opens at http://localhost:7799
```

If you don't pass a path it defaults to `~/Documents/GitHub`.

## Run on startup (macOS)

Add an alias to your shell profile:

```bash
alias branches='node ~/path/to/git-dashboard.js ~/your/projects'
```
