# Whetstone Research Program

## Objective
Improve signal classification accuracy and mutation ranking quality. Whetstone must demonstrably detect, classify, and rank corrections from real conversation patterns.

## Eval Command
```bash
npm test 2>&1 | tail -5
# Extract pass count and total from vitest output
# Also run the integration eval:
npx tsx benchmarks/eval.ts 2>/dev/null
```

## Metrics
- `test_pass_rate` (must be 100%, gate — not a target to optimise)
- `classification_accuracy` (primary, higher is better) — % of test signals correctly classified
- `energy_ranking_accuracy` (secondary, higher is better) — % of mutation pairs correctly ordered by energy
- `transfer_precision` (secondary, higher is better) — % of transfer candidates that are genuinely relevant

## Editable Files
- `src/ml/classifier.ts` — signal classifier
- `src/ml/embeddings.ts` — joint embedding space
- `src/ml/energy.ts` — energy function MLP
- `src/ml/transfer.ts` — cross-agent transfer
- `src/whetstone.ts` — orchestration
- `src/sense.ts` — signal detection (rule-based)
- `src/mutate.ts` — mutation generation
- `src/validate.ts` — validation logic

## Off-Limits
- `tests/**` — do not modify existing tests (may add new ones)
- `src/safety.ts` — safety system is frozen
- `src/types.ts` — type definitions are frozen
- `benchmarks/dataset.json` — eval data (read-only)

## Constraints
- All tests must pass before eval
- No Ollama dependency during offline eval (mock embeddings)
- One change per experiment
- General-purpose improvements only

## Research Directions
1. **Build eval benchmark first** — create `benchmarks/eval.ts` and `benchmarks/dataset.json` with labelled signal examples and mutation ranking pairs. Cannot improve what we cannot measure.
2. **Improve classifier centroid quality** — better synthetic data generation, more diverse examples per category
3. **Energy function architecture** — experiment with hidden layer sizes, activation functions, feature engineering
4. **Better signal detection patterns** — improve regex patterns in sense.ts, reduce false positives
5. **Cross-agent transfer scoring** — tune similarity/validation/domain weights
6. **Integration with real embeddings** — test against Ollama when available, compare mock vs real performance

## Anti-Patterns
- DO NOT hard-code classifications for specific test strings
- DO NOT overfit energy function to synthetic training data
- DO NOT modify safety.ts under any circumstances
- DO NOT add Ollama as a hard dependency (must work offline with mocks)
