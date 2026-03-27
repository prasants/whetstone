import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  isLineImmutable,
  findImmutableLines,
  checkMutationSafety,
  snapshotFiles,
  rollbackFromSnapshot,
  validateMutationTarget,
} from '../src/safety.js';
import { DEFAULT_CONFIG, Mutation } from '../src/types.js';

const TEST_WORKSPACE = resolve(import.meta.dirname, '.test-workspace');
const MARKERS = DEFAULT_CONFIG.immutableMarkers;

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
      '## Formatting Rules (NON-NEGOTIABLE)',
      '- NEVER use em dashes',
      '- ALWAYS use Oxford commas',
      '',
      '## Pre-Flight Checks',
      '- Check nodes.run before SSH (MANDATORY)',
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
      '## SSH',
      '- Host: example.com',
      '',
      '## Notes',
      '- Preferred voice: Nova',
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

describe('isLineImmutable', () => {
  it('detects NON-NEGOTIABLE', () => {
    expect(isLineImmutable('## Rules (NON-NEGOTIABLE)', MARKERS)).toBe(true);
  });

  it('detects MANDATORY', () => {
    expect(isLineImmutable('- Check nodes.run (MANDATORY)', MARKERS)).toBe(true);
  });

  it('detects NEVER', () => {
    expect(isLineImmutable('- NEVER use em dashes', MARKERS)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isLineImmutable('This is non-negotiable', MARKERS)).toBe(true);
  });

  it('returns false for normal lines', () => {
    expect(isLineImmutable('- Be direct and helpful', MARKERS)).toBe(false);
  });

  it('returns false for empty lines', () => {
    expect(isLineImmutable('', MARKERS)).toBe(false);
  });
});

describe('findImmutableLines', () => {
  it('finds all immutable lines in a file', () => {
    const results = findImmutableLines(
      resolve(TEST_WORKSPACE, 'SOUL.md'),
      MARKERS,
    );

    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.every((r) => r.isImmutable)).toBe(true);
  });

  it('returns empty for non-existent file', () => {
    const results = findImmutableLines('/nonexistent/file.md', MARKERS);
    expect(results).toHaveLength(0);
  });

  it('returns empty for file with no immutable lines', () => {
    const results = findImmutableLines(
      resolve(TEST_WORKSPACE, 'TOOLS.md'),
      MARKERS,
    );
    expect(results).toHaveLength(0);
  });
});

describe('checkMutationSafety', () => {
  it('passes for valid add mutation', () => {
    const mutation: Mutation = {
      id: 'M-20260327-001',
      file: 'SOUL.md',
      action: 'add',
      location: '## Style',
      content: '- Use bullet points for lists',
      risk: 'low',
      rationale: 'User prefers bullet points',
      signalCount: 3,
      signalIds: [],
      expectedImpact: 'Reduce style corrections',
    };

    const result = checkMutationSafety(mutation, TEST_WORKSPACE, DEFAULT_CONFIG);
    expect(result.passed).toBe(true);
  });

  it('blocks mutation on immutable line', () => {
    const mutation: Mutation = {
      id: 'M-20260327-002',
      file: 'SOUL.md',
      action: 'modify',
      location: 'NEVER use em dashes',
      content: '- Sometimes use em dashes',
      risk: 'high',
      rationale: 'Testing',
      signalCount: 1,
      signalIds: [],
      expectedImpact: 'None',
    };

    const result = checkMutationSafety(mutation, TEST_WORKSPACE, DEFAULT_CONFIG);
    expect(result.passed).toBe(false);
    expect(result.immutableViolations.length).toBeGreaterThan(0);
  });

  it('blocks mutation on non-mutable file', () => {
    const mutation: Mutation = {
      id: 'M-20260327-003',
      file: 'README.md' as any,
      action: 'add',
      location: '# README',
      content: 'Test',
      risk: 'low',
      rationale: 'Testing',
      signalCount: 1,
      signalIds: [],
      expectedImpact: 'None',
    };

    const result = checkMutationSafety(mutation, TEST_WORKSPACE, DEFAULT_CONFIG);
    expect(result.passed).toBe(false);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('blocks redundant content', () => {
    const mutation: Mutation = {
      id: 'M-20260327-004',
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

    const result = checkMutationSafety(mutation, TEST_WORKSPACE, DEFAULT_CONFIG);
    expect(result.passed).toBe(false);
    expect(result.redundancies.length).toBeGreaterThan(0);
  });
});

describe('snapshotFiles', () => {
  it('creates snapshots of all mutable files', () => {
    const snapshotDir = snapshotFiles(TEST_WORKSPACE, DEFAULT_CONFIG, '2026-03-27');

    expect(existsSync(resolve(snapshotDir, 'SOUL.md'))).toBe(true);
    expect(existsSync(resolve(snapshotDir, 'TOOLS.md'))).toBe(true);
  });

  it('preserves file contents', () => {
    const snapshotDir = snapshotFiles(TEST_WORKSPACE, DEFAULT_CONFIG, '2026-03-27');

    const original = readFileSync(resolve(TEST_WORKSPACE, 'SOUL.md'), 'utf8');
    const snapshot = readFileSync(resolve(snapshotDir, 'SOUL.md'), 'utf8');
    expect(snapshot).toBe(original);
  });
});

describe('rollbackFromSnapshot', () => {
  it('restores files from snapshot', () => {
    // Take snapshot
    const snapshotDir = snapshotFiles(TEST_WORKSPACE, DEFAULT_CONFIG, '2026-03-27');

    // Modify a file
    writeFileSync(resolve(TEST_WORKSPACE, 'SOUL.md'), 'MODIFIED CONTENT');

    // Rollback
    const result = rollbackFromSnapshot(TEST_WORKSPACE, snapshotDir, DEFAULT_CONFIG);

    expect(result.restored).toContain('SOUL.md');
    const content = readFileSync(resolve(TEST_WORKSPACE, 'SOUL.md'), 'utf8');
    expect(content).toContain('# SOUL.md');
    expect(content).not.toBe('MODIFIED CONTENT');
  });
});

describe('validateMutationTarget', () => {
  it('validates a safe target', () => {
    const result = validateMutationTarget(
      TEST_WORKSPACE,
      'SOUL.md',
      '## Style',
      DEFAULT_CONFIG,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects immutable targets', () => {
    const result = validateMutationTarget(
      TEST_WORKSPACE,
      'SOUL.md',
      'NON-NEGOTIABLE',
      DEFAULT_CONFIG,
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('immutable');
  });

  it('rejects non-mutable files', () => {
    const result = validateMutationTarget(
      TEST_WORKSPACE,
      'README.md' as any,
      '# README',
      DEFAULT_CONFIG,
    );
    expect(result.valid).toBe(false);
  });
});
