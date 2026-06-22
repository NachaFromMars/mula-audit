# Report Generation — Format + Output

## Report Formats

### 1. Markdown (Default)

```markdown
## 🔍 Audit Report — project-name
Date: 2026-03-08 | Agents: 6 | Duration: 4m 23s
Scope: git diff (15 files changed, +342/-89)
Threshold: 80 | Total found: 12 | Reported: 3

---

### Critical (1)

#### 1. File stream not closed on error path
Confidence: 92 | Flagged by: Bug Hunter, Silent Failure Hunter

File: `src/api/upload.ts:42`
```typescript
try {
  const stream = fs.createReadStream(path);
  await processStream(stream);
} catch (e) {
  // stream never closed!
  throw new UploadError(e.message);
}
```

**Fix:** Add `finally { stream?.close() }` or use `using` declaration.

---

### Important (2)

#### 2. Missing null check on user profile
Confidence: 85 | Flagged by: Bug Hunter

File: `src/services/user.ts:78`
`user.profile.displayName` throws when profile is null (new accounts).

**Fix:** Use `user.profile?.displayName ?? 'Anonymous'`

---

#### 3. No test for oversized file upload
Confidence: 81 | Flagged by: Test Auditor

File: `tests/upload.test.ts`
Max upload size is 10MB but no test validates rejection.

**Fix:** Add test:
```typescript
it('rejects files over 10MB', async () => {
  const bigFile = createMockFile(11 * 1024 * 1024);
  await expect(upload(bigFile)).rejects.toThrow('File too large');
});
```

---

### Summary
| Metric | Value |
|--------|-------|
| Files reviewed | 15 |
| Issues found | 12 |
| After dedup | 8 |
| Reported (>=80) | 3 |
| Critical | 1 |
| Important | 2 |
```

### 2. JSON

```json
{
  "project": "project-name",
  "date": "2026-03-08T10:30:00Z",
  "scope": "diff",
  "config": { "threshold": 80, "agents": 6 },
  "summary": {
    "filesReviewed": 15,
    "totalFound": 12,
    "afterDedup": 8,
    "reported": 3,
    "critical": 1,
    "important": 2
  },
  "issues": [
    {
      "id": 1,
      "file": "src/api/upload.ts",
      "line": 42,
      "severity": "critical",
      "confidence": 92,
      "description": "File stream not closed on error path",
      "flaggedBy": ["bug-hunter", "silent-failure-hunter"],
      "suggestion": "Add finally { stream?.close() }"
    }
  ]
}
```

### 3. GitHub PR Comment

```bash
node scripts/mula-audit.mjs run --dir . --pr 42
```

Posts comment on PR #42 via `gh pr comment`:

```markdown
### 🔍 Code Audit

Found 3 issues (filtered from 12):

1. **File stream not closed on error path** (confidence: 92)
   https://github.com/owner/repo/blob/{sha}/src/api/upload.ts#L40-L45

2. **Missing null check on user profile** (confidence: 85)
   https://github.com/owner/repo/blob/{sha}/src/services/user.ts#L76-L80

3. **No test for oversized file upload** (confidence: 81)
   `tests/upload.test.ts` — missing edge case test

---
🤖 Generated with Mula Audit (OpenClaw)
```

## Report Sections

### Required
1. Header (project, date, scope, threshold)
2. Issues grouped by severity (Critical > Important)
3. Summary table

### Optional
- Agent breakdown (which agent found what)
- Files most affected
- Comparison with previous audit
- Suggested priority order for fixes

## Empty Report

When no issues meet threshold:

```markdown
## 🔍 Audit Report — project-name
Date: 2026-03-08 | Agents: 6

### No Issues Found ✅

Checked 15 files for bugs, style, types, tests, error handling, and comments.
No issues met the confidence threshold (80).

12 potential issues were found but filtered as low-confidence or false positives.
```

## Report File Location

```
~/.openclaw/workspace/audits/
├── project-name-2026-03-08.md
├── project-name-2026-03-08.json
└── project-name-2026-03-07.md
```
