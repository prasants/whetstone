# Sense Prompt — Signal Extraction

Injected into heartbeats or run at session end.

## Instructions for the Agent

Scan the current session for improvement signals. For each signal found, store it in ThoughtLayer:

```
thoughtlayer_add(
  domain: "whetstone",
  title: "[signal] <type>: <summary>",
  content: <JSON below>
)
```

### Signal JSON Schema

```json
{
  "type": "correction|failure|takeover|frustration|style|success",
  "what": "One sentence: what happened",
  "root_cause": "Why the agent got it wrong — be specific, not generic",
  "suggested_rule": "A concrete, testable rule that would prevent this",
  "confidence": "high|medium|low",
  "category": "tool_use|knowledge|style|judgment|speed|memory",
  "context": "The specific exchange (max 150 chars)",
  "session_date": "YYYY-MM-DD",
  "tools_involved": ["tool1", "tool2"],
  "files_involved": ["SOUL.md"]
}
```

### Signal Type Definitions

| Type | Trigger | Example |
|------|---------|---------|
| correction | User explicitly corrects agent | "No, use X not Y", "I meant...", "Wrong" |
| failure | Tool fails, agent retries same approach, dead end | Tool call returns error 3x |
| takeover | User does the task after agent couldn't | User runs the command themselves |
| frustration | Profanity, caps, "I already told you" | Strong negative reaction |
| style | User reformats or rewrites agent output | User edits the agent's draft |
| success | Task completed, no corrections needed | "Thanks", "Perfect", approval |

### Extraction Rules

1. **Concrete only.** Every signal must have a specific `suggested_rule`, not "be more careful"
2. **Skip user errors.** If the user gave wrong information and corrected themselves, that's not an agent signal
3. **One signal per issue.** Don't create 5 signals for the same conversation about the same problem
4. **Prioritise corrections and failures.** Successes are nice to track but corrections drive improvement
5. **No speculation.** Only extract what clearly happened, not what might have happened
6. **Dedup against ThoughtLayer.** Before adding, query `thoughtlayer_query("whetstone <type> <root_cause>")`. If a nearly identical signal exists from the same day, skip it
