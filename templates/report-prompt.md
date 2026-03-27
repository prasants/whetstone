# Monthly Capability Report

Run on the 1st of each month in an isolated session.

## Instructions

Generate a comprehensive capability report by querying ThoughtLayer.

### Data Collection

```
# All signals from last 30 days
thoughtlayer_query("whetstone signal", topK: 50)

# All mutations from last 30 days
thoughtlayer_query("whetstone mutation", topK: 20)

# All validations
thoughtlayer_query("whetstone validation", topK: 20)

# Previous month's report (for comparison)
thoughtlayer_query("whetstone report", topK: 1)
```

### Report Structure

Write to `.whetstone/reports/YYYY-MM.md`:

```markdown
# Capability Report — YYYY-MM

## Summary
- Total signals: N (↑↓ vs last month)
- Corrections: N | Failures: N | Successes: N
- Mutations applied: N | Kept: N | Rolled back: N
- Capability score: X% sessions with zero corrections

## Signal Trends
- Most common category: [category] (N signals)
- Improving: [categories where signals decreased]
- Worsening: [categories where signals increased]

## Mutations This Month
| ID | Summary | Verdict | Impact |
|----|---------|---------|--------|

## Top 3 Remaining Weak Spots
1. [Pattern that keeps recurring]
2. [Pattern that keeps recurring]
3. [Pattern that keeps recurring]

## Recommendations
- [What to focus on next month]
- [Potential high-impact mutations to try]

## Capability Score History
| Month | Score | Signals | Mutations |
|-------|-------|---------|-----------|
```

### Also store in ThoughtLayer:

```
thoughtlayer_add(
  domain: "whetstone",
  title: "[report] Capability Report YYYY-MM",
  content: <the full report markdown>
)
```

### Send to user:
Message the user with a 3-line summary + link to full report.
