import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  applyMutation,
  applyMutationBatch,
  generateMutationId,
} from '../src/mutate.js';
import { DEFAULT_CONFIG, Mutation } from '../src/types.js';

const TEST_WORKSPACE = resolve(import.meta.dirname, '.test-workspace-mutate');

function setupWorkspace() {
  mkdirSync(resolve(TEST_WORKSPACE, '.whetstone', 'rollbacks'), { recursive: true });

  writeFileSync(
    resolve(TEST_WORKSPACE, 'SOUL.md'),
    [
      '# SOUL.md',
      '',
      '## Personality',
      '- Be direct and helpful',
      '',
      '## Pre-Flight Checks',
      '- Check calendar before scheduling',
      '',
      '## Rules (NON-NEGOTIABLE)',
      '- NEVER share private data',
      '',
      '## Style',
      '- Keep responses concise',
    ].join('\n'),
  );

  writeFileSync(
    resolve(TEST_WORKSPACE, 'TOOLS.md'),
    [
      '# TOOLS.md',
      '',
      '## Notes',
      '- Use node runner for remote commands',
    ].join('\n'),
  );
}

function cleanWorkspace() {
  if (existsSync(TEST_WORKSPACE)) {
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  }
}

beforeEach(() => {
  cleanWorkspace();
  setupWorkspace();
});

afterEach(() => {
  cleanWorkspace();
});

describe('applyMutation', () => {
  it('adds content after anchor line', () => {
    const mutation: Mutation = {
      id: 'M-20260327-001',
      file: 'SOUL.md',
      action: 'add',
      location: '## Pre-Flight Checks',
      content: '- Verify database connection before querying',
      risk: 'low',
      rationale: 'Agent failed 3 times due to stale DB connection',
      signalCount: 3,
      signalIds: ['s1', 's2', 's3'],
      expectedImpact: 'Eliminate DB connection failures',
    };

    const result = applyMutation(mutation, TEST_WORKSPACE, DEFAULT_CONFIG);
    expect(result.applied).toBe(true);

    const content = readFileSync(resolve(TEST_WORKSPACE, 'SOUL.md'), 'utf8');
    expect(content).toContain('Verify database connection before querying');
  });

  it('modifies a non-immutable line', () => {
    const mutation: Mutation = {
      id: 'M-20260327-002',
      file: 'SOUL.md',
      action: 'modify',
      location: 'Keep responses concise',
      content: '- Keep responses concise and use bullet points',
      risk: 'medium',
      rationale: 'User prefers bullet-point format',
      signalCount: 4,
      signalIds: [],
      expectedImpact: 'Reduce style corrections',
    };

    const result = applyMutation(mutation, TEST_WORKSPACE, DEFAULT_CONFIG);
    expect(result.applied).toBe(true);

    const content = readFileSync(resolve(TEST_WORKSPACE, 'SOUL.md'), 'utf8');
    expect(content).toContain('use bullet points');
  });

  it('blocks modification of immutable lines', () => {
    const mutation: Mutation = {
      id: 'M-20260327-003',
      file: 'SOUL.md',
      action: 'modify',
      location: 'NEVER share private data',
      content: '- Sometimes share data if asked nicely',
      risk: 'high',
      rationale: 'Testing safety',
      signalCount: 1,
      signalIds: [],
      expectedImpact: 'None',
    };

    const result = applyMutation(mutation, TEST_WORKSPACE, DEFAULT_CONFIG);
    expect(result.applied).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('fails gracefully for missing anchor', () => {
    const mutation: Mutation = {
      id: 'M-20260327-004',
      file: 'SOUL.md',
      action: 'add',
      location: '## Nonexistent Section',
      content: '- Some new rule',
      risk: 'low',
      rationale: 'Testing',
      signalCount: 1,
      signalIds: [],
      expectedImpact: 'None',
    };

    const result = applyMutation(mutation, TEST_WORKSPACE, DEFAULT_CONFIG);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('rejects redundant content', () => {
    const mutation: Mutation = {
      id: 'M-20260327-005',
      file: 'SOUL.md',
      action: 'add',
      location: '## Style',
      content: 'Keep responses concise',
      risk: 'low',
      rationale: 'Testing',
      signalCount: 1,
      signalIds: [],
      expectedImpact: 'None',
    };

    const result = applyMutation(mutation, TEST_WORKSPACE, DEFAULT_CONFIG);
    expect(result.applied).toBe(false);
  });
});

describe('applyMutationBatch', () => {
  it('creates snapshot before applying mutations', () => {
    const mutations: Mutation[] = [
      {
        id: 'M-20260327-001',
        file: 'SOUL.md',
        action: 'add',
        location: '## Pre-Flight Checks',
        content: '- New check: verify API keys',
        risk: 'low',
        rationale: 'API key failures',
        signalCount: 3,
        signalIds: [],
        expectedImpact: 'Fewer API failures',
      },
    ];

    const { snapshotDir, results } = applyMutationBatch(
      mutations,
      TEST_WORKSPACE,
      DEFAULT_CONFIG,
    );

    expect(existsSync(snapshotDir)).toBe(true);
    expect(existsSync(resolve(snapshotDir, 'SOUL.md'))).toBe(true);
    expect(results[0].applied).toBe(true);
  });

  it('applies multiple mutations in order', () => {
    const mutations: Mutation[] = [
      {
        id: 'M-20260327-001',
        file: 'SOUL.md',
        action: 'add',
        location: '## Pre-Flight Checks',
        content: '- Check A',
        risk: 'low',
        rationale: 'Test',
        signalCount: 3,
        signalIds: [],
        expectedImpact: 'Test',
      },
      {
        id: 'M-20260327-002',
        file: 'TOOLS.md',
        action: 'add',
        location: '## Notes',
        content: '- Tool tip B',
        risk: 'low',
        rationale: 'Test',
        signalCount: 3,
        signalIds: [],
        expectedImpact: 'Test',
      },
    ];

    const { results } = applyMutationBatch(mutations, TEST_WORKSPACE, DEFAULT_CONFIG);
    expect(results.every((r) => r.applied)).toBe(true);
  });
});

describe('generateMutationId', () => {
  it('generates ID in correct format', () => {
    const id = generateMutationId(1, new Date('2026-03-27'));
    expect(id).toBe('M-20260327-001');
  });

  it('pads index to 3 digits', () => {
    const id = generateMutationId(42, new Date('2026-03-27'));
    expect(id).toBe('M-20260327-042');
  });

  it('handles large index values', () => {
    const id = generateMutationId(999, new Date('2026-01-01'));
    expect(id).toBe('M-20260101-999');
  });
});
