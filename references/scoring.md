# Scoring System — Confidence + Merge Logic

## Confidence Scale

| Range | Label | Meaning | Action |
|-------|-------|---------|--------|
| 0-25 | Noise | False positive, pre-existing, or linter territory | Drop |
| 26-50 | Nitpick | Style preference not in project rules | Drop |
| 51-75 | Valid-Low | Real issue but low impact | Optional |
| 76-89 | Important | Needs attention, will cause issues | Recommend fix |
| 90-100 | Critical | Will crash/corrupt in production | Must fix |

## Default Threshold

**Report threshold: 80** (configurable via `--threshold`)

Issues below threshold are silently dropped. They appear in verbose/debug output only.

## Confidence Boost Rules

When multiple agents independently flag the same issue, confidence increases:

| Condition | Boost |
|-----------|-------|
| 2 agents flag same file+line | +10 |
| 3+ agents flag same file+line | +20 |
| Issue matches explicit project guideline | +15 |
| Issue on critical path (auth, payment, data) | +10 |
| Cap | 100 (never exceeds) |

### Dedup + Merge Algorithm

```javascript
function mergeIssues(allIssues) {
  // Group by file + line (within 5 lines tolerance)
  const groups = groupByLocation(allIssues, { lineTolerance: 5 });
  
  return groups.map(group => {
    // Take highest confidence as base
    const base = group.sort((a, b) => b.confidence - a.confidence)[0];
    
    // Apply boosts
    const agentCount = new Set(group.map(i => i.agent)).size;
    let boost = 0;
    if (agentCount >= 3) boost += 20;
    else if (agentCount >= 2) boost += 10;
    
    // Merge descriptions
    const descriptions = group.map(i => `[${i.agent}] ${i.description}`);
    
    return {
      ...base,
      confidence: Math.min(100, base.confidence + boost),
      flaggedBy: group.map(i => i.agent),
      mergedDescriptions: descriptions
    };
  });
}
```

### Location Grouping

Two issues are "same location" if:
- Same file path
- Line numbers within 5 lines of each other
- Similar description (>60% word overlap)

```javascript
function isSameLocation(a, b) {
  if (a.file !== b.file) return false;
  if (Math.abs(a.line - b.line) > 5) return false;
  return wordOverlap(a.description, b.description) > 0.6;
}
```

## Severity Mapping

| Agent Severity | Numeric | Weight in Final Score |
|----------------|---------|----------------------|
| critical | 3 | High priority |
| important | 2 | Medium priority |
| minor | 1 | Low priority |

When multiple agents disagree on severity, use the highest.

## False Positive Patterns

### Auto-drop (confidence = 0):
- Issue on line not modified in diff (pre-existing)
- Import statement issues (linter territory)
- Formatting issues (prettier territory)
- Type errors (compiler territory)
- Issues explicitly silenced (eslint-disable, @ts-ignore with comment)

### Reduce confidence (-20):
- Issue is stylistic but no guideline exists
- Issue is in test file (lower impact)
- Issue is in generated code
- Issue flagged by only 1 agent with confidence < 70

## Quality Metrics

After audit, compute summary metrics:

```json
{
  "totalIssuesFound": 12,
  "afterDedup": 8,
  "afterThreshold": 3,
  "critical": 1,
  "important": 2,
  "minor": 0,
  "avgConfidence": 87,
  "agentCoverage": {
    "bug-hunter": 4,
    "style-guardian": 2,
    "type-analyzer": 1,
    "test-auditor": 3,
    "silent-failure-hunter": 1,
    "comment-analyzer": 1
  }
}
```
