# Architecture

Whetstone is a self-improvement system for AI agents. This document explains how it works, why it's built this way, and where the ML roadmap is headed.

## Design Principles

**1. Behaviour over facts.** Storing "don't use SSH" as a retrievable fact is fragile. Writing it into the agent's operating instructions is durable. Whetstone rewrites config files, not knowledge bases.

**2. Evidence over vibes.** Every mutation is validated against real outcomes. If correction frequency doesn't decrease, the mutation gets rolled back. No accumulated cruft.

**3. Safety over speed.** Every mutation has a rollback snapshot. Immutable lines are never touched. Removals require human approval. The system can only make the agent better or revert to the last known good state.

**4. Local over cloud.** All ML models run on Ollama. All data stays in ThoughtLayer on disk. No API keys, no data exfiltration, no cloud dependency.

**5. Composition over monoliths.** Small models doing one thing well, composed together, outperform a single large model trying to do everything. This is the core architectural conviction.

## System Overview

```
┌─────────────────────────────────────────────────┐
│                  Agent Session                   │
│                                                  │
│  User ↔ Agent ↔ Tools                           │
│       │                                          │
│       ▼                                          │
│  ┌──────────┐                                    │
│  │  SENSE   │  Extract signals from conversation │
│  └────┬─────┘                                    │
│       │                                          │
│       ▼                                          │
│  ThoughtLayer (domain: whetstone)                │
│  ┌──────────────────────────────────┐            │
│  │  Signals  │  Mutations  │ Rules │            │
│  │  (daily)  │  (weekly)   │(comp.)│            │
│  └──────────────────────────────────┘            │
└─────────────────────────────────────────────────┘
         │                    ▲
         ▼                    │
┌─────────────┐      ┌───────────────┐
│   MUTATE    │─────▶│   VALIDATE    │
│  (weekly)   │      │ (week after)  │
│  isolated   │      │   isolated    │
└─────────────┘      └───────────────┘
         │
         ▼
  Agent config files
  (SOUL.md, TOOLS.md,
   AGENTS.md, HEARTBEAT.md)
```

## Loop 1: Sense

**Frequency:** Every heartbeat (when session has >5 exchanges)
**Runtime:** In-session (no isolation needed)
**Cost:** One prompt per session, or zero with the ML classifier (roadmap)

### What It Extracts

Six signal types, each detected by specific conversational patterns:

| Signal | Detection Pattern | Confidence Heuristic |
|--------|-------------------|----------------------|
| Correction | User contradicts agent output | Words: "no," "actually," "I meant," "wrong" |
| Failure | Tool returns error, agent retries same approach | Same tool called ≥2 times with similar args |
| Takeover | User performs the action after agent attempted it | User runs a command the agent just tried |
| Frustration | Negative sentiment spike | Profanity, ALL CAPS, "I already told you" |
| Style | User reformats agent output | User edits/rewrites within 2 messages |
| Success | Task completed, user approves | "Thanks," "perfect," thumbs up, no corrections |

### Signal Schema

```typescript
interface Signal {
  type: 'correction' | 'failure' | 'takeover' | 'frustration' | 'style' | 'success';
  what: string;           // One sentence: what happened
  rootCause: string;      // Why the agent got it wrong
  suggestedRule: string;   // Concrete rule to prevent recurrence
  confidence: 'high' | 'medium' | 'low';
  category: 'tool_use' | 'knowledge' | 'style' | 'judgment' | 'speed' | 'memory';
  context: string;        // The specific exchange (max 150 chars)
  sessionDate: string;    // ISO date
  toolsInvolved: string[];
  filesInvolved: string[];
}
```

### Storage

Each signal becomes a ThoughtLayer entry:
- **Domain:** `whetstone`
- **Title:** `[signal] <type>: <one-line summary>`
- **Content:** Full signal JSON
- **Relationships:** Automatically linked to tools, files, and related signals

### Deduplication

Before storing a new signal, Whetstone queries ThoughtLayer for semantically similar signals from the same day. If the cosine similarity exceeds 0.85, the new signal is dropped. This prevents the same correction from generating multiple entries.

## Loop 2: Mutate

**Frequency:** Weekly (configurable)
**Runtime:** Isolated agent session (separate context window)
**Cost:** One agent turn with full ThoughtLayer context

### Pipeline

```
Signals (7 days) → Cluster → Filter → Propose → Safety Check → Snapshot → Apply → Store
```

#### Step 1: Cluster by Root Cause

Signals are embedded using ThoughtLayer's vector search. Signals within cosine distance 0.3 of each other are grouped into clusters. Each cluster represents a recurring pattern.

Example cluster: "Agent defaults to familiar tool instead of checking for the correct one"
- Signal A: "Used SSH when nodes.run was available"
- Signal B: "Used curl when the message tool existed"
- Signal C: "Used grep when ThoughtLayer query would have worked"

These three signals have different surface text but the same root cause. The embedding space captures this.

#### Step 2: Filter for Generalisability

Every proposed mutation must pass the overfitting test:

**Reject if:**
- The rule references a specific query, input, or conversation
- The rule is a lookup table for a specific domain
- The rule would prevent exactly one failure and no others

**Accept if:**
- The rule is a general principle ("check X before doing Y")
- The rule applies to a class of situations ("all remote execution")
- The rule codifies an explicit user preference ("use tables for comparisons")

#### Step 3: Propose Mutations

```typescript
interface Mutation {
  id: string;             // M-YYYYMMDD-NNN
  file: string;           // Target file (SOUL.md, TOOLS.md, etc.)
  action: 'add' | 'modify';
  location: string;       // Anchor text (insert after this line)
  content: string;        // The rule text to add or modify
  risk: 'low' | 'medium' | 'high';
  rationale: string;      // Why, citing signal count and types
  signalCount: number;
  signalIds: string[];
  expectedImpact: string;
}
```

#### Step 4: Safety Checks

Before any mutation is applied:

1. **Immutability check:** Scan target file for `NON-NEGOTIABLE`, `MANDATORY`, `NEVER`. These lines are untouchable.
2. **Conflict check:** Does the new rule contradict an existing one? If yes, scope the new rule more narrowly.
3. **Redundancy check:** Does an equivalent rule already exist? If yes, skip.
4. **Capacity check:** Maximum five mutations per week.

#### Step 5: Snapshot and Apply

1. Copy all mutable files to `.whetstone/rollbacks/YYYY-MM-DD/`
2. Apply mutations using text insertion (add) or line replacement (modify)
3. Store mutation details in ThoughtLayer with links to source signals
4. Notify the user with a summary

### Mutable Files

Whetstone can modify exactly four files:

| File | Purpose | Typical Mutations |
|------|---------|-------------------|
| `SOUL.md` | Agent personality and rules | Pre-flight checks, behaviour rules |
| `TOOLS.md` | Tool-specific notes and tips | Tool usage patterns, gotchas |
| `AGENTS.md` | Multi-agent coordination | Delegation rules, handoff patterns |
| `HEARTBEAT.md` | Periodic check instructions | New check items, monitoring rules |

No other files are touched. Source code, user data, and system configuration are off limits.

## Loop 3: Validate

**Frequency:** Runs as part of the weekly mutate cycle
**Runtime:** Same isolated session as mutate
**Cost:** Included in the mutate turn

### Validation Logic

For each mutation applied 7–14 days ago:

```
signals_before = count(signals of same type/category, 7 days before mutation)
signals_after  = count(signals of same type/category, 7 days after mutation)

if signals_after < signals_before → KEEP
if signals_after >= signals_before → ROLLBACK
if signals_after == 0 AND signals_before <= 1 → EXTEND (one more week)
```

### Rollback Procedure

1. Read the snapshot from `.whetstone/rollbacks/YYYY-MM-DD/`
2. Restore the affected file to its pre-mutation state
3. Store a validation entry in ThoughtLayer: `[validation] M-ID: rollback`
4. Notify the user

### Why This Works

Most agent improvement systems add rules but never remove them. Over time, the agent's instructions become bloated with contradictory, outdated, or ineffective rules. Validation prevents this by killing mutations that don't earn their place through measurable improvement.

## ML Roadmap

The current system is rule-based. The roadmap introduces learned components that replace hand-coded heuristics with models trained on accumulated data.

### Phase 1: Signal Classifier (Weeks 4–8)

**Goal:** Replace the LLM-based sense prompt with a local classifier.

**Architecture:**
```
Conversation → Embedding (nomic-embed-text) → Classifier Head → Signal Type
```

The classifier is a small feedforward network (2 hidden layers, 256 units each) trained on top of frozen nomic-embed-text embeddings.

**Training data:** Every signal extracted by the rule-based system becomes a labelled example. The conversation context is the input; the signal type is the label.

**Why this matters:** The sense prompt costs tokens every heartbeat. A local classifier costs nothing and runs in milliseconds. At scale (ten agents, 48 heartbeats per day), the token savings are substantial.

**Validation:** Hold out 20% of signals. The classifier must match or exceed the rule-based system's precision on the held-out set before it replaces the prompt.

### Phase 2: Joint Embedding Space (Weeks 6–10)

**Goal:** Cluster signals by root cause, not surface text.

**Architecture (JEPA-inspired):**
```
Signal Text ──→ Encoder ──→ Signal Embedding ─┐
                                                ├──→ Joint Space
Context Text ──→ Encoder ──→ Context Embedding ┘
                                                     │
Rule Text ────→ Encoder ──→ Rule Embedding ──────────┘
```

The encoders share weights (Siamese architecture on top of nomic-embed-text). Training uses contrastive loss: signals that led to the same mutation are positive pairs; signals that led to different mutations are negative pairs.

**Why JEPA:** LeCun's Joint Embedding Predictive Architecture learns to predict representations, not raw data. For Whetstone, this means learning a space where "used the wrong tool" clusters together regardless of which tool or which conversation. The model learns the abstract pattern, not the specific instance.

### Phase 3: Energy-Based Mutation Ranking (Weeks 8–16)

**Goal:** Replace vibes-based mutation ranking with a learned energy function.

**Architecture:**
```
Mutation Embedding ─┐
                     ├──→ MLP ──→ Energy Score (lower = better)
Context Embedding ──┘
```

The MLP takes the concatenation of a mutation embedding and the current agent state embedding, and outputs a scalar energy score.

**Training:** Each validated mutation provides a label:
- Mutation kept → energy target = 0.0 (good mutation)
- Mutation rolled back → energy target = 1.0 (bad mutation)
- Mutation extended → energy target = 0.5 (uncertain)

Loss function: MSE between predicted energy and target.

**Cold start problem:** The energy function needs 50–100 validated mutations to train reliably. During the cold start period, the LLM-based ranking continues. The energy function shadows it, and its predictions are logged for later evaluation.

### Phase 4: Cross-Agent Transfer (Week 16+)

**Goal:** Rules validated by one agent transfer to similar contexts in other agents.

**Mechanism:**

1. When Agent A validates a mutation, the rule embedding is stored with a transfer flag
2. When Agent B encounters a similar context (cosine similarity > 0.7 in the joint space), the validated rule is surfaced as a candidate
3. The energy function scores the candidate in Agent B's context
4. If the energy score is below threshold, the rule is proposed as a transfer mutation

**Weighting:**

```
transfer_score = (semantic_similarity × 0.4) +
                 (validation_score × 0.4) +
                 (domain_overlap × 0.2)
```

Domain overlap is computed from the tools and file types involved. A rule about database queries transfers better to another database-heavy agent than to a research agent.

**Safety:** Transfer mutations always start at medium risk, requiring notice. They are never auto-applied at low risk, because cross-agent transfer is inherently less certain than within-agent learning.

## Data Flow

```
Session ──→ Sense ──→ ThoughtLayer ──→ Mutate ──→ Config Files
                          │                           │
                          │                           ▼
                          │                      Validate
                          │                           │
                          ◀───────────────────────────┘
                      (rollback if needed)
```

## Scaling Considerations

**Single agent:** ~50 signals/week, ~3 mutations/week, ~1MB ThoughtLayer data/month.
**Ten agents:** ~500 signals/week, ~30 mutations/week, ~10MB/month.
**Hundred agents:** ~5,000 signals/week, ~300 mutations/week, ~100MB/month.

ThoughtLayer handles this comfortably. The ML models are small (< 10MB each) and inference is sub-millisecond on CPU.

## Security Model

- Whetstone operates on config files only. It cannot modify source code, system files, or user data.
- All mutations are logged and traceable back to specific signals.
- Immutable markers (`NON-NEGOTIABLE`, `MANDATORY`, `NEVER`) create hard boundaries.
- The validate loop prevents bad mutations from persisting.
- Monthly capability reports give full transparency.
- Whetstone cannot modify its own sense, mutate, or validate logic.

## Why Not Fine-Tune the LLM?

Fine-tuning the base model is tempting but wrong for this use case:

1. **Opacity:** You can't inspect what a fine-tuned model learned. Whetstone's mutations are readable text in config files.
2. **Rollback:** You can't un-learn a fine-tuned behaviour. Whetstone reverts with a file copy.
3. **Portability:** A fine-tuned model is locked to one provider. Whetstone works with any LLM.
4. **Cost:** Fine-tuning is expensive. Small local models on Ollama are free.
5. **Composability:** You can't compose fine-tuned behaviours. You can compose rules.

The right architecture keeps the LLM general-purpose and moves specialisation into lightweight, inspectable, reversible layers above it.
