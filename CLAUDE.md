# CLAUDE.md — Whetstone

## What This Is

Whetstone is a self-improving agent framework. It audits agent behaviour, detects when the agent gets things wrong, and gradually rewrites the agent's configuration files to prevent recurrence. The core loop: **sense → mutate → validate**.

Every AI agent is stuck in groundhog day — making the same mistakes, forgetting the same corrections. Whetstone fixes this by turning user frustration into durable behaviour changes, validated by evidence and reversible by design.

**Version:** 1.2.0
**Language:** TypeScript (strict mode)
**Runtime dependencies:** Zero
**Author:** Prasant Sudhakaran
**Licence:** MIT

## Build & Test

```bash
npm install
npm run build          # tsc → dist/
npm test               # vitest
npm run lint           # tsc --noEmit
```

Node ≥18 required. ES modules.

Known test issue: `safety.test.ts` and `mutate.test.ts` (26 tests) fail in read-only filesystem environments because they write to temp directories. They pass on a normal filesystem. If you see these fail, check permissions before assuming code bugs.

## Architecture

```
src/
├── whetstone.ts        # Main orchestrator (488 lines)
├── types.ts            # Core type definitions
├── config.ts           # Configuration loading
├── sense.ts            # Signal detection — regex pattern matching (207 lines)
├── mutate.ts           # Mutation proposal & application (183 lines)
├── validate.ts         # Effectiveness measurement (96 lines)
├── safety.ts           # Immutability, conflicts, redundancy (235 lines) ← FROZEN
├── recorder.ts         # Execution trace recording (316 lines)
├── analyser.ts         # Post-task analysis, degradation detection (298 lines)
├── evolution.ts        # Skill evolution from execution evidence (431 lines)
└── ml/
    ├── classifier.ts   # Centroid-based signal classifier (438 lines)
    ├── embeddings.ts   # Joint embedding space for clustering (208 lines)
    ├── energy.ts       # Energy-based mutation ranking, 2-layer MLP (464 lines)
    └── transfer.ts     # Cross-agent rule transfer (232 lines)
```

**Total:** ~4,000 lines of TypeScript.

## The Three Loops

### Loop 1: SENSE (every heartbeat/session)
Scan conversations for improvement signals. Six signal types:
- **correction** — user contradicts agent ("no, use X not Y")
- **failure** — tool fails, agent retries same approach
- **takeover** — user does the task themselves after agent fails
- **frustration** — profanity, caps, "I already told you"
- **style** — user reformats/rewrites agent output
- **success** — task completed with no corrections

Detection: rule-based regex patterns in `sense.ts`. ML classifier in `ml/classifier.ts` shadows and eventually replaces regex after ~100 real signals.

Storage: ThoughtLayer (domain: "whetstone"). Dedup via cosine similarity > 0.85.

### Loop 2: MUTATE (weekly)
Cluster signals by root cause, filter overfitting, propose mutations, safety-check, snapshot, apply, store.

Mutable files: `SOUL.md`, `TOOLS.md`, `AGENTS.md`, `HEARTBEAT.md`
Immutable markers: `NON-NEGOTIABLE`, `MANDATORY`, `NEVER` (case-insensitive)

Risk levels:
- 🟢 Low (add note) → auto-apply
- 🟡 Medium (add rule, modify style) → auto-apply + notice
- 🔴 High (modify existing rule) → requires human approval
- ⛔ Critical (remove rule) → HARD BLOCK, never automatic

### Loop 3: VALIDATE (weekly, after mutate)
Count signals of same type before vs after mutation (7-day window).
- signals_after < signals_before → KEEP
- signals_after >= signals_before → ROLLBACK
- signals_after == 0 AND signals_before <= 1 → EXTEND (one more week)

All rollbacks restore from `.whetstone/rollbacks/YYYY-MM-DD/` snapshots.

## ML Components

### Signal Classifier (`ml/classifier.ts`)
Centroid-based on nomic-embed-text embeddings (Ollama). Cold-starts on 100+ synthetic examples per type. Current accuracy: **100% type, 86.7% category**. Keyword fallback for offline mode.

### Joint Embedding Space (`ml/embeddings.ts`)
JEPA-inspired. Clusters signals by root cause (not surface text). Positive pair = signals that led to same mutation.

### Energy Function (`ml/energy.ts`)
2-layer MLP (64 hidden, ReLU, sigmoid output). Ranks mutations by predicted effectiveness. Current accuracy: **80% ranking**. Needs 50-100 validated mutations before it's production-reliable. LLM-based ranking shadows in parallel until then.

### Cross-Agent Transfer (`ml/transfer.ts`)
Share validated rules between agents. Score = semantic_similarity × 0.4 + validation_score × 0.4 + domain_overlap × 0.2. Transfer mutations always start at medium risk.

## Integration with ThoughtLayer

Whetstone stores everything in ThoughtLayer under domain "whetstone":
- Signals: `thoughtlayer_add(domain: "whetstone", title: "[signal] type: summary")`
- Mutations: `thoughtlayer_add(domain: "whetstone", title: "[mutation] M-ID: summary")`
- Validations: `thoughtlayer_add(domain: "whetstone", title: "[validation] M-ID: verdict")`

ThoughtLayer is a peer project at github.com/prasants/thoughtlayer. Changes to ThoughtLayer's query or add APIs may require updates here.

## Known Issues & Improvement Areas

### Reliability
- **Test failures in safety.test.ts and mutate.test.ts** due to filesystem permission assumptions. Tests write to temp dirs and expect write access. Need to mock the filesystem or use OS-agnostic temp paths.
- **1 TODO in evolution.ts** (~line 188): "track per-skill success rate". This metric would improve skill evolution decisions.

### Features
- **Sense is regex-only in production.** The ML classifier exists but only shadows. Need a clean switchover path once enough real signals accumulate (target: 100 signals).
- **Energy function cold-start problem.** Below 50 validated mutations, it's unreliable. The LLM shadow ranking works but costs tokens. Could improve cold-start with transfer learning from other Whetstone deployments.
- **No validation cron job exists yet.** Validate runs as part of the mutate cycle, but there's no standalone scheduled validation. In practice, Prasant's setup runs validate inside the weekly mutate cron — but this means a mutation applied on Sunday is only validated the following Sunday, not mid-week.
- **Cross-agent transfer is untested with real multi-agent data.** The code works with synthetic data but hasn't been validated across Prasant's 10-agent squad.

### Architecture
- **safety.ts is marked FROZEN.** This is intentional — the safety module must not be modified by Whetstone itself (self-referential safety violation). But it could still benefit from review and improvement by a human or external tool.
- **No persistence for ML model weights.** The classifier, energy function, and embedding space train from scratch each time unless `exportWeights()`/`importWeights()` are called explicitly. Should auto-persist to `.whetstone/models/`.
- **recorder.ts JSONL traces grow unbounded.** No rotation or archival. Over months, `.whetstone/traces/` could get large.

## CLI Commands

```bash
npx whetstone-bootstrap                    # One-time init
npx whetstone-sense --stdin < transcript   # Extract signals
npx whetstone-sense --dry-run              # Preview without storing
npx whetstone-mutate                       # Propose and apply mutations
npx whetstone-mutate --dry-run             # Propose without applying
npx whetstone-mutate --rollback YYYY-MM-DD # Restore from snapshot
npx whetstone-validate                     # Validate last week's mutations
```

## Research Program

See `program.md` for the ML improvement roadmap. Three experiments completed:
1. exp-001: keyword fallback → 3.3% → 76.7% type accuracy
2. exp-002: improved patterns → 76.7% → 100% type accuracy
3. exp-003: text features in energy function → 40% → 80% ranking accuracy

Next priorities: train on real signals, tune energy hidden size, improve transfer scoring, test with real Ollama embeddings.

Eval command: `npx tsx benchmarks/eval.ts`

## Conventions

- British spellings in docs and comments
- Zero runtime dependencies — keep it that way. DevDeps only for build/test.
- All mutations are reversible. Never delete a rollback snapshot.
- Tests before merge. `npm test` must pass (excluding known FS permission failures).
- `safety.ts` is FROZEN. Do not modify without explicit approval from Prasant.

## What NOT to Change

- The sense → mutate → validate loop structure. Improve individual stages, don't restructure.
- The immutability system (NON-NEGOTIABLE/MANDATORY/NEVER markers). This is a hard safety boundary.
- Zero runtime dependencies. This is deliberate.
- The rollback/snapshot mechanism. Every mutation must be reversible.
- `safety.ts` without explicit approval.
- MIT licence.
