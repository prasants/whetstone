# Whetstone

**Your AI agent audits itself and gradually rewrites its own behaviour.**

Every AI agent is stuck in groundhog day. It makes a mistake, gets corrected, forgets the correction when the session ends, and makes the same mistake tomorrow. You correct it again. And again. The agent never learns.

Whetstone fixes this. Three loops, running at different frequencies, turn corrections into durable behaviour changes:

1. **Sense** — extracts improvement signals from every conversation
2. **Mutate** — proposes and applies behaviour changes weekly
3. **Validate** — measures whether changes helped, rolls back what didn't

The result: an agent that gets measurably better every week, without you doing anything.

## Why It Works

Most "learning" systems store facts. Whetstone stores *behaviour changes*. The distinction matters.

When you tell an agent "don't use SSH, use the node runner," a fact-storage system files that away and hopes semantic search retrieves it at the right moment. Whetstone, by contrast, rewrites the agent's configuration files — its `SOUL.md`, its `TOOLS.md` — so the rule is baked into the agent's operating instructions. It doesn't need to *remember* the rule. It *is* the rule.

Every change has a rollback snapshot. Every change gets validated against real outcomes. If a mutation doesn't reduce the signal that triggered it, it gets reverted. No accumulation of dead rules. No config drift. Just compounding improvement.

## Quick Start

```bash
# Install as an OpenClaw skill
openclaw skill install whetstone

# Bootstrap (one-time setup)
cd your-workspace
npx whetstone-bootstrap

# That's it. Sensing starts on the next heartbeat.
```

No configuration required. Works with any agent, any model.

## The Three Loops

### Loop 1: Sense (every session)

A heartbeat hook scans the current conversation for improvement signals:

| Signal | Trigger | Example |
|--------|---------|---------|
| Correction | User explicitly corrects the agent | "No, use X not Y" |
| Failure | Tool call fails, agent retries the same approach | Three failed API calls |
| Takeover | User does the task after the agent couldn't | User runs the command themselves |
| Frustration | Strong negative reaction | Profanity, caps, "I already told you" |
| Style | User reformats the agent's output | User rewrites the draft |
| Success | Task completed without corrections | "Perfect, thanks" |

Signals are stored in [ThoughtLayer](https://github.com/prasants/thoughtlayer) with full relationship tracking. Each signal links to the tools involved, the files affected, and the root cause.

**Manual run:** `npx whetstone-sense --stdin < transcript.txt`

### Loop 2: Mutate (weekly)

An isolated agent session:

1. Queries ThoughtLayer for the last seven days of signals
2. Clusters them by root cause using semantic similarity
3. Filters out overfitting (signal-specific fixes that don't generalise)
4. Proposes mutations ranked by expected impact
5. Applies safe mutations automatically, flags risky ones for approval
6. Snapshots every affected file before mutation (rollback safety)

Minimum threshold: three signals sharing a root cause, or one explicit correction with high confidence.

**Manual run:** `npx whetstone-mutate` or `npx whetstone-mutate --dry-run`

### Loop 3: Validate (the week after mutation)

For each active mutation:

- Count signals of the same type in the week after versus the week before
- If signals decreased → **keep** (the mutation worked)
- If signals stayed the same or increased → **rollback** (it didn't help)
- If insufficient data → **extend** the provisional period by one week

**Manual run:** `npx whetstone-validate`

## Mutation Safety

Whetstone can add rules. It can modify existing rules with notice. It cannot remove rules, ever. That requires a human.

| Mutation Type | Risk | Approval |
|---------------|------|----------|
| Add note to TOOLS.md | 🟢 Low | Automatic |
| Add pre-flight check | 🟢 Low | Automatic |
| Add anti-pattern warning | 🟢 Low | Automatic |
| Modify response style | 🟡 Medium | Automatic with notice |
| Add rule to SOUL.md | 🟡 Medium | Automatic with notice |
| Modify existing rule | 🔴 High | Requires human approval |
| Remove a rule | ⛔ Critical | Hard block, never automatic |

Lines tagged `NON-NEGOTIABLE`, `MANDATORY`, or `NEVER` are immutable. Whetstone respects them absolutely.

## ThoughtLayer Integration

All data lives in [ThoughtLayer](https://github.com/prasants/thoughtlayer) (domain: `whetstone`):

- **Semantic deduplication** — "SSH failed" and "can't connect via SSH" cluster automatically
- **Relationship graph** — trace any rule back to the corrections that created it
- **Temporal decay** — recent signals weigh more than stale ones
- **Cross-agent transfer** — one agent's learning benefits every agent sharing the same ThoughtLayer
- **Queryable** — the agent can ask "what do I keep getting wrong about X?" mid-session

### Why ThoughtLayer, Not Flat Files

Flat files work for simple cases. But when you have ten agents generating hundreds of signals per week, you need semantic search, relationship tracking, and temporal weighting. ThoughtLayer provides all three with zero cloud dependency — it runs entirely on local models via Ollama.

## ML Architecture (Roadmap)

Whetstone's current loops are rule-based. The roadmap replaces hand-coded heuristics with small, specialised models that learn from accumulated data.

### Signal Classifier

Replace the LLM-based sense prompt with a fine-tuned local classifier. The training signal is free — it's already in every conversation:

- User contradicts agent → correction
- User re-does a task → takeover
- Sentiment shift after agent response → frustration

A small model (fine-tuned on top of nomic-embed-text embeddings) learns to detect these patterns from conversation structure alone, without spending tokens on the sense prompt at every heartbeat.

### Joint Embedding Space

Embed signals, contexts, and rules into a shared representation space where signals with the same root cause cluster together, even when the surface text differs. "Agent used SSH instead of the node runner" and "Agent defaulted to the familiar tool instead of the correct one" become neighbours.

Training data: every signal→mutation→validation triple. If two signals led to the same successful mutation, their embeddings converge.

### Energy-Based Mutation Ranking

Train an energy function E(mutation, context) → score:

- Low energy = high confidence the mutation will reduce correction frequency
- High energy = uncertain or likely ineffective

After 50–100 mutation cycles, this energy function replaces vibes-based ranking with empirical evidence.

### Cross-Agent Transfer

When one agent learns "always verify database results before presenting them," that learning transfers to every agent that queries databases. The mechanism: retrieve the K nearest validated rules from any agent, weighted by semantic similarity, validation score, and domain overlap.

### The Practical Stack

| Component | Model | Runtime |
|-----------|-------|---------|
| Signal classifier | Fine-tuned nomic-embed-text | Ollama (local) |
| Signal/rule embeddings | nomic-embed-text (base) | Ollama (local) |
| Mutation energy function | Small MLP on embeddings | Python/ONNX (local) |
| Cross-agent retrieval | ThoughtLayer vector search | Already built |

The LLM stays in the loop for mutation *generation*. The ranking, filtering, and validation move to learned models. The LLM proposes; the energy function disposes.

### Cold Start Timeline

| Phase | Duration | What Happens |
|-------|----------|-------------|
| Accumulate | Weeks 1–4 | Rule-based system runs, signals accumulate |
| Classify | Weeks 4–8 | Train signal classifier, switch from prompt-based to model-based sensing |
| Rank | Weeks 8–16 | Train energy function on mutation→validation pairs |
| Transfer | Week 16+ | Cross-agent transfer learning kicks in |

Full architecture details: [ARCHITECTURE.md](./ARCHITECTURE.md)

## How It Compounds

The improvement curve is not linear. It compounds.

- **Week 1:** Catches obvious tool failures and explicit corrections
- **Week 4:** Learns style preferences and communication patterns
- **Week 12:** Has internalised decision-making heuristics
- **Week 24:** Feels like it read your mind

The delta between a week-1 agent and a week-24 agent is enormous. And it happened without you lifting a finger.

## Monthly Capability Report

On the first of each month, Whetstone generates a comprehensive review:

- Rules added, modified, and rolled back
- Signal frequency trends (are corrections decreasing?)
- Top three remaining weak spots
- Capability score (percentage of sessions with zero corrections)
- Recommendations for the coming month

Stored in ThoughtLayer for longitudinal tracking and in `.whetstone/reports/` as Markdown.

## File Structure

```
.whetstone/
├── config.json         # Settings (model, schedule, thresholds)
├── rollbacks/          # Pre-mutation file snapshots
│   └── YYYY-MM-DD/
└── reports/            # Monthly capability reports
    └── YYYY-MM.md
```

Signal data, mutations, rules, and anti-patterns live in ThoughtLayer. The only local files are configuration, rollback snapshots, and rendered reports. No flat-file sprawl.

## Configuration

```json
{
  "version": "1.0.0",
  "senseModel": null,
  "mutateSchedule": "weekly",
  "approvalThreshold": "medium",
  "minSignalsForMutation": 3,
  "maxMutationsPerWeek": 5,
  "immutableMarkers": ["NON-NEGOTIABLE", "MANDATORY", "NEVER"],
  "thoughtlayerDomain": "whetstone"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `senseModel` | `null` (session default) | Model for signal extraction |
| `mutateSchedule` | `"weekly"` | How often mutations run |
| `approvalThreshold` | `"medium"` | Auto-approve up to this risk level |
| `minSignalsForMutation` | `3` | Minimum signals to trigger a mutation |
| `maxMutationsPerWeek` | `5` | Cap on weekly mutations |
| `immutableMarkers` | `["NON-NEGOTIABLE", ...]` | Strings that mark lines as immutable |
| `thoughtlayerDomain` | `"whetstone"` | ThoughtLayer domain for all entries |

## Requirements

- [OpenClaw](https://github.com/openclaw/openclaw) (agent runtime)
- [ThoughtLayer](https://github.com/prasants/thoughtlayer) (semantic memory)
- Node.js 18+
- Ollama (recommended, for local embeddings)

## Contributing

Whetstone is opinionated software. Contributions are welcome if they:

1. Solve a real problem (not a theoretical one)
2. Include tests
3. Don't break the safety guarantees
4. Use British English and Oxford commas

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## Licence

MIT — see [LICENCE](./LICENCE).

## Acknowledgements

The sense-mutate-validate loop was inspired by biological evolution: variation, selection, and retention. The ML architecture draws on Yann LeCun's work on self-supervised learning, joint embedding predictive architectures, and energy-based models. The conviction that small, specialised models composed together outperform monolithic ones is central to both LeCun's vision and Whetstone's design.

The name comes from the sharpening stone. You sharpen the blade not by adding metal, but by removing what doesn't belong.
