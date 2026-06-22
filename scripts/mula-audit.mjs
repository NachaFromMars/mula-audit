#!/usr/bin/env node
/**
 * mula-audit.mjs — Multi-agent code audit STATE MANAGER for OpenClaw
 * 
 * Script manages audit state. Agent orchestrates (spawns reviewers, merges results).
 * Agent reads SKILL.md → spawns 6 reviewer sub-agents → collects results → 
 * feeds to this script for merge/scoring/report.
 * 
 * Usage:
 *   node mula-audit.mjs init --dir ~/project --scope diff [--threshold 80] [--quick]
 *   node mula-audit.mjs add-issues --id <id> --agent bug-hunter --issues '[...]'
 *   node mula-audit.mjs merge --id <id>
 *   node mula-audit.mjs report --id <id> [--format md|json]
 *   node mula-audit.mjs status --id <id>
 *   node mula-audit.mjs list
 * 
 * Fork: code-review + pr-review-toolkit (Anthropic, MIT)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

// --- Config ---
const AUDITS_DIR = join(homedir(), '.openclaw', 'workspace', 'audits');
const DEFAULT_THRESHOLD = 80;
const AGENT_NAMES = ['bug-hunter', 'style-guardian', 'type-analyzer', 'test-auditor', 'silent-failure-hunter', 'comment-analyzer'];
const QUICK_AGENTS = ['bug-hunter', 'test-auditor', 'silent-failure-hunter'];

// --- Helpers ---
function ensureDir(d) { if (!existsSync(d)) mkdirSync(d, { recursive: true }); }
function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }
function writeJson(p, d) { writeFileSync(p, JSON.stringify(d, null, 2), 'utf-8'); }
function statePath(id) { return join(AUDITS_DIR, `${id}.json`); }

function getProjectName(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).name || dir.split(/[\\/]/).pop(); }
  catch { return dir.split(/[\\/]/).pop(); }
}

function getGitDiff(dir) {
  try { return execSync('git diff --unified=3', { cwd: dir, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 }); }
  catch { try { return execSync('git diff HEAD --unified=3', { cwd: dir, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 }); } catch { return ''; } }
}

function getGuidelines(dir) {
  let g = '';
  for (const f of ['AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md']) {
    const p = join(dir, f);
    if (existsSync(p)) g += `\n## ${f}\n${readFileSync(p, 'utf-8').slice(0, 3000)}\n`;
  }
  return g;
}

function wordOverlap(a, b) {
  const wa = new Set(a.toLowerCase().split(/\s+/));
  const wb = new Set(b.toLowerCase().split(/\s+/));
  const inter = [...wa].filter(w => wb.has(w));
  return inter.length / Math.max(wa.size, wb.size);
}

function loadOrDie(id) {
  const p = statePath(id);
  if (!existsSync(p)) { console.error(`❌ Audit not found: ${id}`); process.exit(1); }
  const s = readJson(p);
  if (!s) { console.error(`❌ Corrupted state: ${id}`); process.exit(1); }
  return s;
}

function save(state) {
  ensureDir(AUDITS_DIR);
  state.updatedAt = new Date().toISOString();
  writeJson(statePath(state.id), state);
}

// --- Merge Logic ---
function mergeIssues(allIssues, threshold) {
  const groups = [];
  for (const issue of allIssues) {
    let found = false;
    for (const group of groups) {
      const rep = group[0];
      if (rep.file === issue.file && Math.abs((rep.line||0) - (issue.line||0)) <= 5 && wordOverlap(rep.description||'', issue.description||'') > 0.4) {
        group.push(issue);
        found = true;
        break;
      }
    }
    if (!found) groups.push([issue]);
  }
  
  return groups.map(group => {
    const base = group.sort((a, b) => (b.confidence||0) - (a.confidence||0))[0];
    const agents = [...new Set(group.map(i => i.agent))];
    let boost = agents.length >= 3 ? 20 : agents.length >= 2 ? 10 : 0;
    const sev = { critical: 3, important: 2, minor: 1 };
    const maxSev = group.reduce((m, i) => (sev[i.severity]||0) > (sev[m]||0) ? i.severity : m, base.severity);
    
    return {
      ...base,
      confidence: Math.min(100, (base.confidence||0) + boost),
      flaggedBy: agents,
      severity: maxSev
    };
  })
  .filter(i => i.confidence >= threshold)
  .sort((a, b) => {
    const sev = { critical: 3, important: 2, minor: 1 };
    return (sev[b.severity]||0) - (sev[a.severity]||0) || b.confidence - a.confidence;
  });
}

function generateReport(state) {
  const issues = state.mergedIssues || [];
  const critical = issues.filter(i => i.severity === 'critical');
  const important = issues.filter(i => i.severity === 'important');
  const minor = issues.filter(i => i.severity === 'minor');
  
  let r = `## 🔍 Audit Report — ${state.projectName}\n`;
  r += `Date: ${state.updatedAt.split('T')[0]} | Agents: ${state.agentsCompleted.length}/${state.agents.length} | Threshold: ${state.threshold}\n`;
  r += `Scope: ${state.scope} | Raw: ${state.rawIssueCount} | After merge: ${issues.length}\n\n---\n\n`;
  
  if (issues.length === 0) {
    r += `### No Issues Found ✅\nNo issues met confidence threshold (${state.threshold}).\n`;
    return r;
  }
  
  let n = 0;
  if (critical.length) {
    r += `### Critical (${critical.length})\n\n`;
    critical.forEach(i => { n++; r += issueBlock(n, i); });
  }
  if (important.length) {
    r += `### Important (${important.length})\n\n`;
    important.forEach(i => { n++; r += issueBlock(n, i); });
  }
  if (minor.length) {
    r += `### Minor (${minor.length})\n\n`;
    minor.forEach(i => { n++; r += `${n}. **${i.description}** (${i.confidence}) — \`${i.file}\`\n`; });
  }
  
  r += `\n### Summary\n| Metric | Value |\n|--------|-------|\n`;
  r += `| Critical | ${critical.length} |\n| Important | ${important.length} |\n| Minor | ${minor.length} |\n`;
  r += `| Avg Confidence | ${Math.round(issues.reduce((s, i) => s + i.confidence, 0) / issues.length)} |\n`;
  return r;
}

function issueBlock(n, i) {
  let b = `#### ${n}. ${i.description}\n`;
  b += `Confidence: ${i.confidence} | Flagged by: ${i.flaggedBy.join(', ')}\n\n`;
  b += `File: \`${i.file}${i.line ? ':' + i.line : ''}\`\n`;
  if (i.evidence) b += `\`\`\`\n${i.evidence}\n\`\`\`\n`;
  if (i.suggestion) b += `**Fix:** ${i.suggestion}\n`;
  b += `\n---\n\n`;
  return b;
}

// --- Commands ---

function cmdInit(dir, options) {
  dir = resolve(dir);
  const projectName = getProjectName(dir);
  const agents = options.quick ? QUICK_AGENTS : AGENT_NAMES;
  const threshold = parseInt(options.threshold || DEFAULT_THRESHOLD);
  const scope = options.scope || 'diff';
  const id = `audit-${projectName}-${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}`;
  
  // Get code context
  let codeContext = '';
  if (scope === 'diff') codeContext = getGitDiff(dir);
  const guidelines = getGuidelines(dir);
  
  const state = {
    id, projectName, dir, scope, threshold, agents,
    status: 'collecting',
    rawIssues: {},  // { agent-name: [issues] }
    agentsCompleted: [],
    agentsPending: [...agents],
    mergedIssues: null,
    rawIssueCount: 0,
    codeContextSize: codeContext.length,
    hasGuidelines: guidelines.length > 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  save(state);
  
  console.log(JSON.stringify({
    ok: true,
    action: 'init',
    id,
    projectName,
    agents,
    threshold,
    scope,
    codeContextSize: codeContext.length,
    hasGuidelines: guidelines.length > 0
  }));
}

function cmdAddIssues(id, agentName, issuesJson, issuesFile) {
  const state = loadOrDie(id);
  
  let issues;
  try {
    if (issuesFile && existsSync(issuesFile)) {
      let raw = readFileSync(issuesFile, 'utf-8');
      // Strip BOM
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      issues = JSON.parse(raw.trim());
    } else if (issuesJson) {
      let raw = issuesJson;
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      issues = JSON.parse(raw.trim());
    } else {
      console.error('❌ Need --issues or --issues-file');
      process.exit(1);
    }
  }
  catch (e) { console.error(`❌ Invalid JSON: ${e.message}`); process.exit(1); }
  
  if (!Array.isArray(issues)) issues = [issues];
  
  // Tag each issue with agent name
  issues = issues.map(i => ({ ...i, agent: agentName }));
  
  state.rawIssues[agentName] = issues;
  state.agentsCompleted = [...new Set([...state.agentsCompleted, agentName])];
  state.agentsPending = state.agents.filter(a => !state.agentsCompleted.includes(a));
  state.rawIssueCount = Object.values(state.rawIssues).flat().length;
  
  save(state);
  
  console.log(JSON.stringify({
    ok: true,
    action: 'add-issues',
    agent: agentName,
    issuesAdded: issues.length,
    agentsCompleted: state.agentsCompleted.length,
    agentsPending: state.agentsPending,
    totalRawIssues: state.rawIssueCount
  }));
}

function cmdMerge(id) {
  const state = loadOrDie(id);
  
  const allIssues = Object.values(state.rawIssues).flat();
  const merged = mergeIssues(allIssues, state.threshold);
  
  state.mergedIssues = merged;
  state.status = 'merged';
  save(state);
  
  console.log(JSON.stringify({
    ok: true,
    action: 'merge',
    rawCount: allIssues.length,
    afterMerge: merged.length,
    critical: merged.filter(i => i.severity === 'critical').length,
    important: merged.filter(i => i.severity === 'important').length,
    minor: merged.filter(i => i.severity === 'minor').length
  }));
}

function cmdReport(id, format) {
  const state = loadOrDie(id);
  
  if (!state.mergedIssues) {
    console.error('❌ Run merge first: node mula-audit.mjs merge --id ' + id);
    process.exit(1);
  }
  
  if (format === 'json') {
    console.log(JSON.stringify({
      ok: true,
      project: state.projectName,
      date: state.updatedAt,
      threshold: state.threshold,
      issues: state.mergedIssues,
      summary: {
        raw: state.rawIssueCount,
        merged: state.mergedIssues.length,
        critical: state.mergedIssues.filter(i => i.severity === 'critical').length,
        important: state.mergedIssues.filter(i => i.severity === 'important').length,
        minor: state.mergedIssues.filter(i => i.severity === 'minor').length
      }
    }));
  } else {
    const report = generateReport(state);
    // Save report file
    const reportPath = join(AUDITS_DIR, `${state.projectName}-${state.updatedAt.split('T')[0]}.md`);
    writeFileSync(reportPath, report, 'utf-8');
    console.log(report);
    console.error(`\nReport saved: ${reportPath}`);
  }
}

function cmdStatus(id) {
  const state = loadOrDie(id);
  console.log(`📊 Audit: ${state.id}`);
  console.log(`Project: ${state.projectName}`);
  console.log(`Dir: ${state.dir}`);
  console.log(`Scope: ${state.scope} | Threshold: ${state.threshold}`);
  console.log(`Status: ${state.status}`);
  console.log(`Agents: ${state.agentsCompleted.length}/${state.agents.length} complete`);
  if (state.agentsPending.length) console.log(`Pending: ${state.agentsPending.join(', ')}`);
  console.log(`Raw issues: ${state.rawIssueCount}`);
  if (state.mergedIssues) console.log(`Merged issues: ${state.mergedIssues.length} (above threshold ${state.threshold})`);
}

function cmdList() {
  ensureDir(AUDITS_DIR);
  const files = readdirSync(AUDITS_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) { console.log('No audits found.'); return; }
  
  console.log(`📋 Audits (${files.length})\n`);
  files.sort().reverse().forEach(f => {
    const s = readJson(join(AUDITS_DIR, f));
    if (!s) return;
    const icon = { collecting: '🔄', merged: '✅' }[s.status] || '❓';
    console.log(`${icon} ${s.id}`);
    console.log(`   ${s.projectName} | ${s.agentsCompleted.length}/${s.agents.length} agents | ${s.rawIssueCount} raw issues`);
    if (s.mergedIssues) console.log(`   Merged: ${s.mergedIssues.length} (C:${s.mergedIssues.filter(i=>i.severity==='critical').length} I:${s.mergedIssues.filter(i=>i.severity==='important').length})`);
    console.log();
  });
}

// --- Main ---
const [,, cmd, ...args] = process.argv;
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    const val = args[i+1] && !args[i+1].startsWith('--') ? args[i+1] : true;
    flags[key] = val; if (val !== true) i++;
  }
}

try {
  switch (cmd) {
    case 'init':
      if (!flags.dir) { console.error('Usage: mula-audit init --dir ~/project [--scope diff|all] [--threshold 80] [--quick]'); process.exit(1); }
      cmdInit(flags.dir, { scope: flags.scope, threshold: flags.threshold, quick: flags.quick });
      break;
    case 'add-issues':
      if (!flags.id || !flags.agent || (!flags.issues && !flags['issues-file'])) { console.error('Need --id --agent (--issues \'[...]\' or --issues-file path)'); process.exit(1); }
      cmdAddIssues(flags.id, flags.agent, flags.issues, flags['issues-file']);
      break;
    case 'merge':
      if (!flags.id) { console.error('Need --id'); process.exit(1); }
      cmdMerge(flags.id);
      break;
    case 'report':
      if (!flags.id) { console.error('Need --id'); process.exit(1); }
      cmdReport(flags.id, flags.format || 'md');
      break;
    case 'status':
      if (!flags.id) { console.error('Need --id'); process.exit(1); }
      cmdStatus(flags.id);
      break;
    case 'list':
      cmdList();
      break;
    default:
      console.log('mula-audit — Multi-agent code audit state manager for OpenClaw');
      console.log('');
      console.log('Commands:');
      console.log('  init        Create audit       --dir ~/project [--scope diff] [--threshold 80] [--quick]');
      console.log('  add-issues  Add agent results   --id <id> --agent bug-hunter --issues \'[{...}]\'');
      console.log('  merge       Merge + score        --id <id>');
      console.log('  report      Generate report      --id <id> [--format md|json]');
      console.log('  status      Show status           --id <id>');
      console.log('  list        List all audits');
  }
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
}
