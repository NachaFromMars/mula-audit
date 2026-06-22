---
name: mula-audit
description: "6-agent code quality audit — spawn reviewers in parallel, merge results with confidence scoring. Agent orchestrates, script manages state + merge. Features: 6 specialized reviewers, confidence boosting, dedup, threshold filtering, markdown/JSON report. Dùng khi: code review, PR review, quality audit, find bugs. Triggers: mula-audit, code audit, review code, find bugs, quality check, audit PR."
---

# Mula Audit — Multi-Agent Code Quality Audit for OpenClaw

> "6 chuyên gia, 1 báo cáo thống nhất."

## Tổng Quan

Mula Audit = 6 reviewer agents song song:
1. Init audit → script tạo state
2. Agent spawn 6 reviewer sub-agents song song
3. Mỗi reviewer trả JSON issues
4. Agent feed issues vào script
5. Script merge + confidence scoring + dedup
6. Generate report (MD/JSON)

**Architecture:** Script (`mula-audit.mjs`) quản lý STATE + MERGE. Agent (bạn) quản lý EXECUTION (spawn reviewers).

Fork từ:
- [code-review](https://github.com/anthropics/claude-code-plugins-official) (Anthropic)
- [pr-review-toolkit](https://github.com/anthropics/claude-code-plugins-official) (Anthropic)

## 6 Reviewer Agents

| Agent | Focus | Catches |
|-------|-------|---------|
| **bug-hunter** | Logic errors, edge cases | NPE, off-by-one, race conditions |
| **style-guardian** | Code style, DRY, naming | Duplication, bad names, complexity |
| **type-analyzer** | Type safety, nullability | Missing null checks, wrong types |
| **test-auditor** | Test coverage gaps | Missing tests, untested edge cases |
| **silent-failure-hunter** | Error handling | Empty catch, swallowed errors |
| **comment-analyzer** | Comment quality | Stale comments, missing docs |

Quick mode (`--quick`): Only bug-hunter, test-auditor, silent-failure-hunter

## Protocol — Agent Follow Exactly

### Bước 1: Init Audit

```bash
node scripts/mula-audit.mjs init \
  --dir ~/project \
  --scope diff \
  --threshold 80
```

Script trả JSON:
```json
{
  "ok": true,
  "id": "audit-myproject-20260308T100000",
  "agents": ["bug-hunter", "style-guardian", ...],
  "threshold": 80,
  "codeContextSize": 15234
}
```

### Bước 2: Get Code Context

Đọc git diff hoặc files:
```bash
git diff --unified=3
```

### Bước 3: Spawn 6 Reviewers (Parallel)

Dùng `sessions_spawn` cho mỗi agent:

```
sessions_spawn(
  agentId: "kilo",
  message: <agent prompt from agents/bug-hunter.md> + code context,
  model: "claudible/claude-opus-4.6"
)
```

Agent prompt templates: `agents/*.md`

### Bước 4: Collect Results

Mỗi reviewer trả JSON array:
```json
[
  {
    "file": "src/api.ts",
    "line": 42,
    "severity": "critical",
    "confidence": 92,
    "description": "File stream not closed on error path",
    "suggestion": "Add finally block"
  }
]
```

### Bước 5: Feed to Script

Via file (recommended — avoids escaping issues):
```bash
echo '[...]' > /tmp/bugs.json
node scripts/mula-audit.mjs add-issues \
  --id audit-myproject-... \
  --agent bug-hunter \
  --issues-file /tmp/bugs.json
```

Or inline (careful with escaping):
```bash
node scripts/mula-audit.mjs add-issues \
  --id ... \
  --agent bug-hunter \
  --issues '[{...}]'
```

### Bước 6: Merge + Report

Sau khi tất cả agents xong (hoặc đủ 3+ agents):

```bash
# Merge with confidence scoring + dedup
node scripts/mula-audit.mjs merge --id audit-...

# Generate report
node scripts/mula-audit.mjs report --id audit-... --format md
```

## Confidence Scoring

### Base Confidence
Each reviewer assigns 0-100 confidence per issue.

### Boosts
- **2 agents flag same location**: +10
- **3+ agents flag same location**: +20
- **Cap**: 100

### Threshold
Default 80. Issues below threshold are dropped from report.
Configurable via `--threshold`.

### Dedup
Issues within 5 lines of each other + 40% word overlap = merged.
Highest confidence becomes base. Severity = highest among group.

## CLI Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `init` | Create audit | `--dir --scope [--threshold] [--quick]` |
| `add-issues` | Add reviewer results | `--id --agent (--issues \| --issues-file)` |
| `merge` | Merge + score | `--id` |
| `report` | Generate report | `--id [--format md\|json]` |
| `status` | Show status | `--id` |
| `list` | List all | - |

## Output Example

```markdown
## 🔍 Audit Report — myproject
Date: 2026-03-08 | Agents: 6/6 | Threshold: 80
Scope: diff | Raw: 12 | After merge: 3

---

### Critical (1)

#### 1. File stream not closed on error path
Confidence: 100 | Flagged by: bug-hunter, silent-failure-hunter

File: `src/api.ts:42`
**Fix:** Add finally block

---
```

## Severity Levels

| Level | Meaning | Example |
|-------|---------|---------|
| **critical** | Will crash/corrupt in production | Null dereference, resource leak |
| **important** | Should fix before merge | Missing validation, bad error handling |
| **minor** | Nice to fix | Style issues, stale comments |

## Structure

```
mula-audit/
├── SKILL.md                     # This file
├── scripts/
│   └── mula-audit.mjs           # State manager + merge (13KB)
├── agents/
│   ├── bug-hunter.md            # Prompt template
│   ├── style-guardian.md
│   ├── type-analyzer.md
│   ├── test-auditor.md
│   ├── silent-failure-hunter.md
│   └── comment-analyzer.md
└── references/
    ├── scoring.md               # Confidence scoring details
    └── merge-report.md          # Report format spec
```
