# mula-audit — Six-agent parallel code quality audit

> Run six specialized reviewer agents in parallel, merge findings with confidence scoring, and get a prioritized Markdown + JSON report. One audit, six perspectives.

[![OpenClaw Skill](https://img.shields.io/badge/OpenClaw-Skill-blueviolet)](https://github.com/NachaFromMars)

## Overview
mula-audit dispatches six specialized agents to inspect code simultaneously from different angles. A script (`mula-audit.mjs`) manages state and merges results with confidence scoring: same location (±5 lines) + 40% word overlap triggers deduplication; findings flagged by 2 agents get +10 confidence, 3+ agents get +20, capped at 100. Only issues scoring ≥80 appear in the final report. Output: prioritized Markdown report (Critical → Important → Minor) + JSON. A quick mode runs just three high-value agents.

## Features
| Agent | Focus |
|---|---|
| bug-hunter | Logic errors, edge cases, NPE, race conditions |
| style-guardian | DRY, naming, complexity |
| type-analyzer | Null checks, type safety |
| test-auditor | Coverage gaps, untested edge cases |
| silent-failure-hunter | Empty catch, swallowed errors |
| comment-analyzer | Stale comments, missing docs |

**Quick mode** (`--quick`): bug-hunter + test-auditor + silent-failure-hunter only

## Usage / Quick Start
```bash
node mula-audit.mjs            # full 6-agent audit
node mula-audit.mjs --quick    # 3-agent fast pass
```

## Trigger Keywords (OpenClaw)
mula-audit, code audit, review code, find bugs, quality check, audit PR

## Related Skills
- [mula-forge-code](https://github.com/NachaFromMars/mula-forge-code) — 7-phase feature development

---
Part of the [NachaFromMars](https://github.com/NachaFromMars) OpenClaw skill ecosystem.
