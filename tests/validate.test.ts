import { describe, it, expect } from 'vitest';
import {
  computeVerdict,
  buildValidation,
  validateBatch,
  getRollbackCandidates,
  getKeepers,
} from '../src/validate.js';
import { Mutation } from '../src/types.js';

const makeMutation = (id: string): Mutation => ({
  id,
  file: 'SOUL.md',
  action: 'add',
  location: '## Rules',
  content: 'Test rule',
  risk: 'low',
  rationale: 'Test',
  signalCount: 3,
  signalIds: [],
  expectedImpact: 'Test',
});

describe('computeVerdict', () => {
  it('keeps when signals decrease', () => {
    expect(computeVerdict(5, 2)).toBe('keep');
  });

  it('keeps when signals drop to zero from many', () => {
    expect(computeVerdict(8, 0)).toBe('keep');
  });

  it('rolls back when signals stay the same', () => {
    expect(computeVerdict(3, 3)).toBe('rollback');
  });

  it('rolls back when signals increase', () => {
    expect(computeVerdict(2, 5)).toBe('rollback');
  });

  it('extends when data is insufficient (0 → 0)', () => {
    expect(computeVerdict(0, 0)).toBe('extend');
  });

  it('extends when data is insufficient (1 → 0)', () => {
    expect(computeVerdict(1, 0)).toBe('extend');
  });

  it('rolls back on 2 → 2 (not extend, enough data)', () => {
    expect(computeVerdict(2, 2)).toBe('rollback');
  });
});

describe('buildValidation', () => {
  it('builds keep validation with positive impact score', () => {
    const mutation = makeMutation('M-20260327-001');
    const validation = buildValidation(mutation, 5, 1);

    expect(validation.mutationId).toBe('M-20260327-001');
    expect(validation.verdict).toBe('keep');
    expect(validation.impactScore).toBe(4);
    expect(validation.reason).toContain('decreased');
  });

  it('builds rollback validation with zero or negative impact', () => {
    const mutation = makeMutation('M-20260327-002');
    const validation = buildValidation(mutation, 3, 5);

    expect(validation.verdict).toBe('rollback');
    expect(validation.impactScore).toBe(-2);
    expect(validation.reason).toContain('increased');
  });

  it('builds extend validation', () => {
    const mutation = makeMutation('M-20260327-003');
    const validation = buildValidation(mutation, 1, 0);

    expect(validation.verdict).toBe('extend');
    expect(validation.reason).toContain('Insufficient');
  });

  it('includes timestamp', () => {
    const mutation = makeMutation('M-20260327-004');
    const validation = buildValidation(mutation, 5, 2);

    expect(validation.validatedAt).toBeDefined();
    expect(new Date(validation.validatedAt).getTime()).not.toBeNaN();
  });
});

describe('validateBatch', () => {
  it('validates all mutations with signal counts', () => {
    const mutations = [
      makeMutation('M-001'),
      makeMutation('M-002'),
      makeMutation('M-003'),
    ];

    const signalCounts = new Map([
      ['M-001', { before: 5, after: 1 }],
      ['M-002', { before: 3, after: 4 }],
      ['M-003', { before: 1, after: 0 }],
    ]);

    const results = validateBatch(mutations, signalCounts);
    expect(results).toHaveLength(3);
    expect(results[0].verdict).toBe('keep');
    expect(results[1].verdict).toBe('rollback');
    expect(results[2].verdict).toBe('extend');
  });

  it('skips mutations without signal counts', () => {
    const mutations = [
      makeMutation('M-001'),
      makeMutation('M-002'),
    ];

    const signalCounts = new Map([
      ['M-001', { before: 5, after: 1 }],
    ]);

    const results = validateBatch(mutations, signalCounts);
    expect(results).toHaveLength(1);
  });
});

describe('getRollbackCandidates', () => {
  it('returns only rollback verdicts', () => {
    const mutations = [
      makeMutation('M-001'),
      makeMutation('M-002'),
      makeMutation('M-003'),
    ];

    const signalCounts = new Map([
      ['M-001', { before: 5, after: 1 }],
      ['M-002', { before: 3, after: 4 }],
      ['M-003', { before: 1, after: 0 }],
    ]);

    const validations = validateBatch(mutations, signalCounts);
    const candidates = getRollbackCandidates(validations);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].mutationId).toBe('M-002');
  });
});

describe('getKeepers', () => {
  it('returns only keep verdicts', () => {
    const mutations = [
      makeMutation('M-001'),
      makeMutation('M-002'),
    ];

    const signalCounts = new Map([
      ['M-001', { before: 5, after: 1 }],
      ['M-002', { before: 3, after: 4 }],
    ]);

    const validations = validateBatch(mutations, signalCounts);
    const keepers = getKeepers(validations);

    expect(keepers).toHaveLength(1);
    expect(keepers[0].mutationId).toBe('M-001');
  });
});
