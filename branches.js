#!/usr/bin/env node
// Branches
// Usage: node branches.js [path/to/your/projects]
// Opens at http://localhost:7799

import { createServer } from 'http'
import { execFileSync, execSync } from 'child_process'
import { readdirSync, existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'

const PORT = 7799
const SEP = '\x1f'

const ICON_PNG = readFileSync(new URL('./icon.png', import.meta.url))

const MANIFEST = JSON.stringify({
  name: 'Branches',
  short_name: 'Branches',
  description: 'Local git branch viewer',
  start_url: '/',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#10b981',
  icons: [
    { src: '/apple-touch-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
  ]
})

// Directory to scan for git repos — pass as a CLI argument or set a default below
const SCAN_DIR = process.argv[2]
  ? resolve(process.argv[2])
  : join(homedir(), 'Development')

// --- Discover git repos ---
// Scans `dir` for git repos. If a subdirectory isn't a repo itself, descends
// one extra level so grouped layouts like ~/Development/<org>/<repo> work.
function findRepos(dir) {
  if (!existsSync(dir)) return []
  const repos = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const childPath = join(dir, e.name)
    if (existsSync(join(childPath, '.git'))) {
      repos.push({ name: e.name, path: childPath })
      continue
    }
    try {
      for (const grand of readdirSync(childPath, { withFileTypes: true })) {
        if (!grand.isDirectory() || grand.name.startsWith('.')) continue
        const grandPath = join(childPath, grand.name)
        if (existsSync(join(grandPath, '.git'))) {
          repos.push({ name: `${e.name}/${grand.name}`, path: grandPath })
        }
      }
    } catch {}
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name))
}

function git(cwd, args, opts = {}) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 8000, ...opts })
}

function getBranchCount(projectPath) {
  try {
    const out = git(projectPath, ['branch', '-vv'], { timeout: 3000 })
    return out.trim().split('\n').filter(l => l && !l.includes(': gone]')).length
  } catch { return 0 }
}

// --- Branch list ---
function getBranches(projectPath) {
  try {
    try { git(projectPath, ['fetch', '--quiet'], { stdio: 'pipe' }) } catch {}
    const fmt = `%(HEAD)${SEP}%(refname:short)${SEP}%(objectname:short)${SEP}%(subject)${SEP}%(committerdate:relative)${SEP}%(upstream:track)${SEP}%(authorname)`
    const out = git(projectPath, ['for-each-ref', '--sort=-committerdate', 'refs/heads/', `--format=${fmt}`])
    return out.trim().split('\n').filter(Boolean).map(line => {
      const [head, name, hash, subject, date, track = '', author = ''] = line.split(SEP)
      return {
        current: head.trim() === '*',
        name, hash, subject, date, author,
        gone: track.includes('gone'),
        ahead: parseInt((track.match(/ahead (\d+)/) || [])[1] || 0),
        behind: parseInt((track.match(/behind (\d+)/) || [])[1] || 0),
      }
    }).filter(b => !b.gone)
  } catch { return [] }
}

function getDefaultBranch(projectPath) {
  try {
    return git(projectPath, ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short']).trim().replace('origin/', '')
  } catch { return 'main' }
}

// --- Branch detail ---
function getBranchDetail(projectPath, branchName, defaultBranch) {
  const detail = { commits: [], files: [], pr: null, ahead: 0, behind: 0 }

  // Commits unique to this branch vs default
  try {
    const fmt = `%h${SEP}%s${SEP}%cr${SEP}%an`
    const out = git(projectPath, ['log', `${defaultBranch}..${branchName}`, `--format=${fmt}`])
    detail.commits = out.trim().split('\n').filter(Boolean).map(line => {
      const [hash, subject, date, author] = line.split(SEP)
      return { hash, subject, date, author }
    })
  } catch {}

  // Ahead/behind count
  try {
    const out = git(projectPath, ['rev-list', '--left-right', '--count', `${defaultBranch}...${branchName}`]).trim()
    const [behind, ahead] = out.split('\t').map(Number)
    detail.ahead = ahead || 0
    detail.behind = behind || 0
  } catch {}

  // Changed files vs default branch
  try {
    const out = git(projectPath, ['diff', '--numstat', `${defaultBranch}...${branchName}`])
    detail.files = out.trim().split('\n').filter(Boolean).map(line => {
      const [add, del, ...nameParts] = line.split('\t')
      return { name: nameParts.join('\t'), additions: parseInt(add) || 0, deletions: parseInt(del) || 0 }
    })
  } catch {}

  // PR status via gh CLI
  try {
    const remoteUrl = git(projectPath, ['remote', 'get-url', 'origin']).trim()
    const repoMatch = remoteUrl.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/)
    if (repoMatch) {
      const repo = repoMatch[1]
      const prJson = execFileSync('gh', ['pr', 'list', '--head', branchName, '--state', 'all',
        '--json', 'number,title,state,url', '-R', repo], { encoding: 'utf8', timeout: 8000 })
      const prs = JSON.parse(prJson)
      if (prs.length) detail.pr = prs[0]
    }
  } catch {}

  return detail
}

// --- HTML ---
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Branches</title>
  <link rel="manifest" href="/manifest.json" />
  <link rel="icon" href="/apple-touch-icon.png" type="image/png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Branches" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="theme-color" content="#ffffff" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #F0F2F5;
      color: #1a2332;
      font-size: 13px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .header {
      background: #ffffff;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid #e2e6ea;
      flex-shrink: 0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .header-title { font-size: 12px; font-weight: 800; color: #10b981; letter-spacing: 0.08em; text-transform: uppercase; flex-shrink: 0; }
    /* Custom dropdown */
    .dropdown { flex: 1; position: relative; min-width: 0; }
    .dropdown-btn {
      width: 100%; background: #F0F2F5; color: #1a2332;
      border: 1px solid #d1d9e0; border-radius: 7px;
      padding: 6px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
      display: flex; align-items: center; gap: 6px; text-align: left;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .dropdown-btn:hover { border-color: #10b981; }
    .dropdown-btn.open { border-color: #10b981; box-shadow: 0 0 0 3px #d1fae5; border-radius: 7px 7px 0 0; }
    .dropdown-btn-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dropdown-btn-count {
      background: #e2e6ea; color: #6b7280; font-size: 10px; font-weight: 700;
      padding: 1px 6px; border-radius: 20px; flex-shrink: 0;
    }
    .dropdown-btn.open .dropdown-btn-count { background: #d1fae5; color: #065f46; }
    .dropdown-arrow { color: #9ca3af; flex-shrink: 0; transition: transform 0.2s; font-size: 10px; }
    .dropdown-btn.open .dropdown-arrow { transform: rotate(180deg); color: #10b981; }
    .dropdown-list {
      display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 100;
      background: #ffffff; border: 1px solid #10b981; border-top: none;
      border-radius: 0 0 7px 7px; box-shadow: 0 8px 20px rgba(0,0,0,0.12);
      max-height: 240px; overflow-y: auto;
    }
    .dropdown-list.open { display: block; }
    .dropdown-item {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; cursor: pointer; transition: background 0.1s;
      font-size: 12px; font-weight: 500; color: #1a2332;
    }
    .dropdown-item:hover { background: #f0fdf4; }
    .dropdown-item.active { background: #f0fdf4; color: #065f46; font-weight: 700; }
    .dropdown-item-name { flex: 1; }
    .dropdown-item-count {
      background: #f3f4f6; color: #9ca3af; font-size: 10px; font-weight: 700;
      padding: 1px 6px; border-radius: 20px;
    }
    .dropdown-item.active .dropdown-item-count { background: #d1fae5; color: #065f46; }
    .dropdown-item-check { color: #10b981; font-size: 11px; width: 14px; flex-shrink: 0; }
    .icon-btn {
      background: none; border: none; color: #9ca3af; cursor: pointer;
      width: 28px; height: 28px; border-radius: 6px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      transition: color 0.15s, background 0.15s;
    }
    .icon-btn:hover { color: #10b981; background: #f0fdf4; }
    .icon-btn.spinning svg { animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .branches { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; }

    /* Branch row */
    .branch-wrap { display: flex; flex-direction: column; }
    .branch {
      background: #ffffff; border: 1px solid #e2e6ea; border-radius: 10px;
      padding: 10px 12px; display: flex; align-items: flex-start; gap: 9px;
      cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s;
      user-select: none; box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }
    .branch:hover { border-color: #10b981; box-shadow: 0 2px 8px rgba(16,185,129,0.1); }
    .branch.current { border-color: #10b981; background: #f0fdf4; }
    .branch.gone { opacity: 0.5; }
    .branch.open { border-radius: 10px 10px 0 0; border-bottom-color: #e2e6ea; box-shadow: none; }
    .branch-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #d1d9e0; flex-shrink: 0; margin-top: 4px;
    }
    .branch.current .branch-dot { background: #10b981; box-shadow: 0 0 0 3px #d1fae5; }
    .branch-info { flex: 1; min-width: 0; }
    .branch-name { font-weight: 700; color: #1a2332; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; display: flex; align-items: center; gap: 5px; }
    .branch.current .branch-name { color: #065f46; }
    .copy-btn {
      background: none; border: none; padding: 1px 3px; cursor: pointer; border-radius: 4px;
      color: #d1d9e0; flex-shrink: 0; line-height: 0;
      transition: color 0.15s, background 0.15s;
    }
    .copy-btn:hover { color: #10b981; background: #d1fae5; }
    .copy-btn.copied { color: #10b981; }
    .copy-btn .icon-check { display: none; }
    .copy-btn.copied .icon-clipboard { display: none; }
    .copy-btn.copied .icon-check { display: inline; }
    .default-pill {
      display: inline-block; font-size: 9px; font-weight: 700; color: #6b7280;
      background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 4px;
      padding: 1px 5px; margin-left: 6px; vertical-align: middle;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .branch-meta { color: #9ca3af; font-size: 11px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .branch-meta .hash { color: #d1d9e0; font-family: monospace; }
    .branch-meta .author { color: #6b7280; font-weight: 500; }
    .badges { display: flex; gap: 3px; align-items: flex-start; flex-shrink: 0; flex-wrap: wrap; justify-content: flex-end; }
    .badge { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 20px; white-space: nowrap; }
    .badge.gone   { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
    .badge.ahead  { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
    .badge.behind { background: #fffbeb; color: #d97706; border: 1px solid #fde68a; }
    .chevron { color: #d1d9e0; font-size: 10px; flex-shrink: 0; margin-top: 4px; transition: transform 0.2s, color 0.15s; }
    .branch.open .chevron { transform: rotate(180deg); color: #10b981; }
    .branch:hover .chevron { color: #10b981; }

    /* Detail panel */
    .detail {
      background: #fafbfc; border: 1px solid #e2e6ea; border-top: none;
      border-radius: 0 0 10px 10px; padding: 14px 16px;
      display: none; flex-direction: column; gap: 16px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.04);
    }
    .detail.open { display: flex; }
    .detail-loading { color: #9ca3af; font-size: 11px; font-style: italic; text-align: center; padding: 10px 0; }
    .detail-section { display: flex; flex-direction: column; gap: 7px; }
    .detail-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #9ca3af; }

    /* PR badge */
    .pr-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 11px; border-radius: 7px; font-size: 11px; font-weight: 600;
      text-decoration: none; border: 1px solid;
    }
    .pr-badge.open   { background: #f0fdf4; color: #16a34a; border-color: #bbf7d0; }
    .pr-badge.merged { background: #f5f3ff; color: #7c3aed; border-color: #ddd6fe; }
    .pr-badge.closed { background: #f9fafb; color: #6b7280; border-color: #e5e7eb; }
    .pr-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

    /* Commits */
    .commit { display: flex; gap: 8px; align-items: baseline; padding: 4px 0; border-bottom: 1px solid #f3f4f6; }
    .commit:last-child { border-bottom: none; }
    .commit-hash { font-family: monospace; font-size: 11px; color: #d1d9e0; flex-shrink: 0; }
    .commit-subject { font-size: 12px; color: #374151; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .commit-meta { font-size: 10px; color: #9ca3af; flex-shrink: 0; white-space: nowrap; }
    .no-data { font-size: 11px; color: #d1d9e0; font-style: italic; }

    /* Files */
    .file { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
    .file-name { font-size: 11px; color: #6b7280; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: monospace; }
    .file-stat { font-size: 10px; font-weight: 700; flex-shrink: 0; display: flex; gap: 4px; }
    .file-stat .add { color: #16a34a; }
    .file-stat .del { color: #dc2626; }

    /* Divergence */
    .divergence { display: flex; gap: 14px; font-size: 12px; }
    .div-item { display: flex; align-items: center; gap: 5px; }
    .div-item .num { font-weight: 800; font-size: 15px; }
    .div-item.d-ahead .num { color: #16a34a; }
    .div-item.d-behind .num { color: #d97706; }
    .div-item .label { color: #9ca3af; }

    .footer {
      padding: 7px 12px; border-top: 1px solid #e2e6ea;
      display: flex; justify-content: space-between; align-items: center;
      color: #9ca3af; font-size: 11px; flex-shrink: 0; background: #ffffff;
    }
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #e2e6ea; border-radius: 2px; }
    ::-webkit-scrollbar-thumb:hover { background: #d1d9e0; }
  </style>
</head>
<body>
  <div class="header">
    <span class="header-title">Branches</span>
    <div class="dropdown" id="dropdown">
      <button class="dropdown-btn" id="dropdown-btn" onclick="toggleDropdown()">
        <span class="dropdown-btn-name" id="dropdown-btn-name">Loading…</span>
        <span class="dropdown-btn-count" id="dropdown-btn-count"></span>
        <span class="dropdown-arrow">▾</span>
      </button>
      <div class="dropdown-list" id="dropdown-list"></div>
    </div>
    <button class="icon-btn" id="refresh-btn" onclick="refresh()" title="Refresh">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
      </svg>
    </button>
  </div>

  <div class="branches" id="branches"><div style="color:#9ca3af;font-style:italic;text-align:center;padding:20px">Loading…</div></div>

  <div class="footer">
    <span id="status"></span>
    <span id="last-updated"></span>
  </div>

  <script>
    let projects = [], currentIdx = 0, openBranch = null

    async function init() {
      const res = await fetch('/api/projects')
      projects = await res.json()
      renderDropdownList()
      loadProject(0)

      // Close dropdown on outside click
      document.addEventListener('click', e => {
        if (!document.getElementById('dropdown').contains(e.target)) closeDropdown()
      })
    }

    function renderDropdownList() {
      document.getElementById('dropdown-list').innerHTML = projects.map((p, i) => \`
        <div class="dropdown-item \${i===currentIdx?'active':''}" onclick="selectProject(\${i})">
          <span class="dropdown-item-check">\${i===currentIdx?'✓':''}</span>
          <span class="dropdown-item-name">\${esc(p.name)}</span>
          <span class="dropdown-item-count">\${p.count}</span>
        </div>
      \`).join('')
    }

    function toggleDropdown() {
      const btn = document.getElementById('dropdown-btn')
      const list = document.getElementById('dropdown-list')
      const open = list.classList.contains('open')
      btn.classList.toggle('open', !open)
      list.classList.toggle('open', !open)
    }

    function closeDropdown() {
      document.getElementById('dropdown-btn').classList.remove('open')
      document.getElementById('dropdown-list').classList.remove('open')
    }

    function selectProject(idx) {
      closeDropdown()
      if (idx === currentIdx) return
      loadProject(idx)
    }

    function updateDropdownBtn() {
      const p = projects[currentIdx]
      document.getElementById('dropdown-btn-name').textContent = p.name
      document.getElementById('dropdown-btn-count').textContent = p.count + ' branch' + (p.count !== 1 ? 'es' : '')
      renderDropdownList()
    }

    async function loadProject(idx) {
      currentIdx = parseInt(idx)
      openBranch = null
      updateDropdownBtn()
      document.getElementById('branches').innerHTML = '<div style="color:#9ca3af;font-style:italic;text-align:center;padding:20px">Loading…</div>'
      const res = await fetch('/api/branches?project=' + currentIdx)
      const { branches, defaultBranch } = await res.json()
      // Update count from actual branch data
      projects[currentIdx].count = branches.length
      updateDropdownBtn()
      renderBranches(branches, defaultBranch)
    }

    function renderBranches(branches, defaultBranch) {
      if (!branches.length) {
        document.getElementById('branches').innerHTML = '<div style="color:#9ca3af;font-style:italic;text-align:center;padding:20px">No branches found</div>'
        return
      }
      const sorted = [
        ...branches.filter(b => b.current),
        ...branches.filter(b => !b.current && b.name === defaultBranch),
        ...branches.filter(b => !b.current && b.name !== defaultBranch),
      ]
      document.getElementById('status').textContent = branches.length + ' branch' + (branches.length !== 1 ? 'es' : '')
      document.getElementById('last-updated').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      document.getElementById('branches').innerHTML = sorted.map(b => \`
        <div class="branch-wrap" data-branch="\${esc(b.name)}">
          <div class="branch \${b.current?'current':''} \${b.gone?'gone':''}"
               onclick="toggleDetail(this, '\${esc(b.name)}')">
            <div class="branch-dot"></div>
            <div class="branch-info">
              <div class="branch-name">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${esc(b.name)}</span>
                \${b.name===defaultBranch&&!b.current?'<span class="default-pill">default</span>':''}
                <button class="copy-btn" onclick="copyBranch(event, this, '\${esc(b.name)}')" title="Copy branch name">
                  <svg class="icon-clipboard" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                  <svg class="icon-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </button>
              </div>
              <div class="branch-meta">
                <span class="hash">\${b.hash}</span>
                · <span class="author">\${esc(b.author)}</span>
                · \${b.date}
                \${b.subject ? '· ' + esc(b.subject.slice(0,55)) + (b.subject.length>55?'…':'') : ''}
              </div>
            </div>
            <div class="badges">
              \${b.gone   ? '<span class="badge gone">gone</span>' : ''}
              \${b.ahead  ? \`<span class="badge ahead">↑\${b.ahead}</span>\` : ''}
              \${b.behind ? \`<span class="badge behind">↓\${b.behind}</span>\` : ''}
            </div>
            <span class="chevron">▾</span>
          </div>
          <div class="detail" id="detail-\${esc(b.name)}">
            <div class="detail-loading">Loading…</div>
          </div>
        </div>
      \`).join('')
    }

    async function toggleDetail(branchEl, branchName) {
      const wrap = branchEl.closest('.branch-wrap')
      const detail = wrap.querySelector('.detail')
      const isOpen = detail.classList.contains('open')

      // Close any open panel
      document.querySelectorAll('.branch.open').forEach(el => {
        el.classList.remove('open')
        el.closest('.branch-wrap').querySelector('.detail').classList.remove('open')
      })

      if (isOpen) return

      branchEl.classList.add('open')
      detail.classList.add('open')
      detail.innerHTML = '<div class="detail-loading">Loading…</div>'

      const res = await fetch(\`/api/branch-detail?project=\${currentIdx}&branch=\${encodeURIComponent(branchName)}\`)
      const data = await res.json()
      renderDetail(detail, data)
    }

    function renderDetail(el, d) {
      const prHtml = d.pr
        ? \`<a class="pr-badge \${d.pr.state.toLowerCase()}" href="\${d.pr.url}" target="_blank">
            <span class="pr-dot"></span>
            #\${d.pr.number} \${esc(d.pr.title)}
            <span style="opacity:0.6;font-size:9px;text-transform:uppercase">\${d.pr.state}</span>
           </a>\`
        : '<span style="color:#334155;font-size:11px;font-style:italic">No pull request</span>'

      const commitsHtml = d.commits.length
        ? d.commits.map(c => \`
            <div class="commit">
              <span class="commit-hash">\${c.hash}</span>
              <span class="commit-subject">\${esc(c.subject)}</span>
              <span class="commit-meta">\${esc(c.author)} · \${c.date}</span>
            </div>\`).join('')
        : '<span class="no-commits">No unique commits vs default branch</span>'

      const filesHtml = d.files.length
        ? d.files.slice(0, 12).map(f => \`
            <div class="file">
              <span class="file-name">\${esc(f.name)}</span>
              <span class="file-stat">
                \${f.additions ? \`<span class="add">+\${f.additions}</span>\` : ''}
                \${f.deletions ? \`<span class="del"> -\${f.deletions}</span>\` : ''}
              </span>
            </div>\`).join('')
          + (d.files.length > 12 ? \`<div style="color:#334155;font-size:10px">+ \${d.files.length-12} more files</div>\` : '')
        : '<span class="no-commits">No file changes vs default branch</span>'

      const divHtml = \`
        <div class="divergence">
          <div class="div-item d-ahead">
            <span class="num">\${d.ahead}</span>
            <span class="label">commit\${d.ahead!==1?'s':''} ahead</span>
          </div>
          <div class="div-item d-behind">
            <span class="num">\${d.behind}</span>
            <span class="label">behind</span>
          </div>
        </div>\`

      el.innerHTML = \`
        <div class="detail-section">
          <div class="detail-label">Pull Request</div>
          \${prHtml}
        </div>
        <div class="detail-section">
          <div class="detail-label">Divergence</div>
          \${divHtml}
        </div>
        <div class="detail-section">
          <div class="detail-label">Commits not in default branch</div>
          \${commitsHtml}
        </div>
        <div class="detail-section">
          <div class="detail-label">Changed files</div>
          \${filesHtml}
        </div>
      \`
    }

    async function copyBranch(e, btn, name) {
      e.stopPropagation()
      await navigator.clipboard.writeText(name)
      btn.classList.add('copied')
      setTimeout(() => btn.classList.remove('copied'), 1500)
    }

    async function refresh() {
      const btn = document.getElementById('refresh-btn')
      btn.classList.add('spinning')
      try {
        const currentName = projects[currentIdx] && projects[currentIdx].name
        const res = await fetch('/api/projects')
        projects = await res.json()
        const matched = projects.findIndex(p => p.name === currentName)
        currentIdx = matched >= 0 ? matched : 0
        renderDropdownList()
        await loadProject(currentIdx)
      } finally {
        btn.classList.remove('spinning')
      }
    }

    function esc(str) {
      return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    }

    init()
  </script>
</body>
</html>`

// --- Server ---
let PROJECTS = findRepos(SCAN_DIR)
if (PROJECTS.length === 0) {
  console.error(`No git repos found in ${SCAN_DIR}`)
  console.error(`Usage: node branches.js [path/to/your/projects]`)
  process.exit(1)
}

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (url.pathname === '/manifest.json') {
    res.writeHead(200, { 'Content-Type': 'application/manifest+json' })
    res.end(MANIFEST)
    return
  }

  if (url.pathname === '/apple-touch-icon.png' || url.pathname === '/favicon.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' })
    res.end(ICON_PNG)
    return
  }

  if (url.pathname === '/api/projects') {
    PROJECTS = findRepos(SCAN_DIR)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(PROJECTS.map(p => ({ name: p.name, count: getBranchCount(p.path) }))))
    return
  }

  if (url.pathname === '/api/branches') {
    const idx = parseInt(url.searchParams.get('project') || '0')
    const project = PROJECTS[idx]
    if (!project) { res.writeHead(404); res.end('{}'); return }
    const branches = getBranches(project.path)
    const defaultBranch = getDefaultBranch(project.path)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ branches, defaultBranch }))
    return
  }

  if (url.pathname === '/api/branch-detail') {
    const idx = parseInt(url.searchParams.get('project') || '0')
    const branch = url.searchParams.get('branch') || ''
    const project = PROJECTS[idx]
    if (!project || !branch) { res.writeHead(404); res.end('{}'); return }
    const defaultBranch = getDefaultBranch(project.path)
    const detail = getBranchDetail(project.path, branch, defaultBranch)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(detail))
    return
  }

  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(HTML)
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Branches → http://localhost:${PORT}`)
  console.log(`Scanning: ${SCAN_DIR}`)
  console.log(`Found ${PROJECTS.length} repos: ${PROJECTS.map(p => p.name).join(', ')}`)
})
