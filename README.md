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

## ML Components (Implemented)

Whetstone includes four ML components that work out of the box. They train on synthetic data at cold start and improve as real data accumulates.

### Signal Classifier

A centroid-based classifier on top of nomic-embed-text embeddings via Ollama. Detects signal types (correction, failure, takeover, frustration, style, success) from conversation text.

- Trains on 100+ synthetic examples at cold start
- Improves as real signals accumulate
- Zero tokens spent per heartbeat (no LLM prompt needed)

```typescript
import { Whetstone } from 'whetstone-agent';

const whetstone = new Whetstone('/path/to/workspace');
await whetstone.init(); // Trains classifier if needed

const signal = await whetstone.detectSignal("No, I meant the other file");
// { type: 'correction', category: 'judgment', confidence: 'high' }
```

### Joint Embedding Space

Signals are embedded into a shared representation space where signals with the same root cause cluster together, even when the surface text differs.

- Automatic clustering by semantic similarity
- Overfitting detection (rejects rules too similar to one specific signal)
- Incremental updates as new signals arrive

### Energy-Based Mutation Ranking

A small MLP (64 hidden units) that predicts mutation effectiveness. Lower energy = higher confidence the mutation will reduce correction frequency.

- Input: mutation embedding + context features
- Output: energy score in [0, 1]
- Trains on synthetic good/bad mutation examples at cold start
- Improves as real validation data accumulates

```typescript
const rankedMutations = await whetstone.rankMutations(proposedMutations);
// Sorted by energy (lowest = best)
```

### Cross-Agent Transfer

When one agent validates a rule, it becomes available to all other agents sharing the same store. Transfer scoring combines semantic similarity, validation impact, and domain overlap.

```typescript
const candidates = await whetstone.getTransferCandidates(
  "database query failing",
  ["database"],  // tools involved
  ["TOOLS.md"],  // files involved
);
// Returns validated rules from other agents, ranked by transfer score
```

### The Practical Stack

| Component | Model | Runtime |
|-----------|-------|---------|
| Signal classifier | Centroid classifier on nomic-embed-text | Ollama (local) |
| Joint embeddings | nomic-embed-text | Ollama (local) |
| Energy function | 2-layer MLP (input→64→1) | Pure TypeScript |
| Cross-agent transfer | Weighted semantic retrieval | Pure TypeScript |

Everything runs locally. No cloud dependency. No API keys.

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
