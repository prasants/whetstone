/**
 * Validation engine.
 *
 * Measures whether applied mutations actually reduced the signal
 * frequency they targeted. Keeps what works, rolls back what doesn't.
 */

import { Mutation, Validation, ValidationVerdict } from './types.js';

/**
 * Compute the validation verdict for a mutation.
 *
 * The logic is deliberately simple and conservative:
 * - Fewer signals after = keep (the mutation helped)
 * - Same or more signals after = rollback (it didn't)
 * - Too little data = extend (give it another week)
 */
export function computeVerdict(
  signalsBefore: number,
  signalsAfter: number,
): ValidationVerdict {
  // Insufficient data: if the pattern didn't recur at all
  // and it was already rare, extend the observation period
  if (signalsAfter === 0 && signalsBefore <= 1) {
    return 'extend';
  }

  // Clear improvement
  if (signalsAfter < signalsBefore) {
    return 'keep';
  }

  // No improvement or regression
  return 'rollback';
}

/**
 * Build a complete validation result.
 */
export function buildValidation(
  mutation: Mutation,
  signalsBefore: number,
  signalsAfter: number,
): Validation {
  const verdict = computeVerdict(signalsBefore, signalsAfter);

  const reasons: Record<ValidationVerdict, string> = {
    keep: `Signals decreased from ${signalsBefore} to ${signalsAfter}. Mutation is effective.`,
    rollback: `Signals ${signalsAfter > signalsBefore ? 'increased' : 'unchanged'} (${signalsBefore} → ${signalsAfter}). Rolling back.`,
    extend: `Insufficient data to judge (${signalsBefore} → ${signalsAfter}). Extending observation by one week.`,
  };

  return {
    mutationId: mutation.id,
    signalsBefore,
    signalsAfter,
    verdict,
    reason: reasons[verdict],
    impactScore: signalsBefore - signalsAfter,
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Batch-validate a set of mutations.
 *
 * Takes a map of mutation ID → { signalsBefore, signalsAfter }
 * and returns validation results for each.
 */
export function validateBatch(
  mutations: Mutation[],
  signalCounts: Map<string, { before: number; after: number }>,
): Validation[] {
  return mutations
    .filter((m) => signalCounts.has(m.id))
    .map((m) => {
      const counts = signalCounts.get(m.id)!;
      return buildValidation(m, counts.before, counts.after);
    });
}

/**
 * Determine which mutations should be rolled back.
 */
export function getRollbackCandidates(
  validations: Validation[],
): Validation[] {
  return validations.filter((v) => v.verdict === 'rollback');
}

/**
 * Determine which mutations have been validated as effective.
 */
export function getKeepers(validations: Validation[]): Validation[] {
  return validations.filter((v) => v.verdict === 'keep');
}
