import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Mock fetch globally before imports
const mockEmbedding = (length: number = 768): number[] =>
  Array(length).fill(0).map(() => Math.random() - 0.5);

// Mock global fetch
global.fetch = vi.fn().mockImplementation(async (url: string) => {
  if (url.includes('/api/embeddings')) {
    return {
      ok: true,
      json: async () => ({ embedding: mockEmbedding() }),
    };
  }
  return { ok: false, status: 404 };
});

import {
  SignalClassifier,
  cosineSimilarity,
  generateSyntheticTrainingData,
  JointEmbeddingSpace,
  EnergyFunction,
  generateSyntheticEnergyTrainingData,
  CrossAgentStore,
  transferToMutation,
} from '../src/ml/index.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const vec = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('throws for mismatched lengths', () => {
    const a = [1, 2, 3];
    const b = [1, 2];
    expect(() => cosineSimilarity(a, b)).toThrow('Vector length mismatch');
  });

  it('returns 0 for zero vectors (regression: NaN bug)', () => {
    const zero = [0, 0, 0];
    const vec = [1, 2, 3];
    expect(cosineSimilarity(zero, vec)).toBe(0);
    expect(cosineSimilarity(vec, zero)).toBe(0);
    expect(cosineSimilarity(zero, zero)).toBe(0);
    // Ensure no NaN propagation
    expect(Number.isNaN(cosineSimilarity(zero, vec))).toBe(false);
  });
});

describe('generateSyntheticTrainingData', () => {
  it('generates examples for all signal types', () => {
    const data = generateSyntheticTrainingData();

    const types = new Set(data.map((d) => d.label));
    expect(types.has('correction')).toBe(true);
    expect(types.has('frustration')).toBe(true);
    expect(types.has('takeover')).toBe(true);
    expect(types.has('failure')).toBe(true);
    expect(types.has('style')).toBe(true);
    expect(types.has('success')).toBe(true);
  });

  it('generates a reasonable number of examples', () => {
    const data = generateSyntheticTrainingData();
    expect(data.length).toBeGreaterThan(50);
  });

  it('all examples have required fields', () => {
    const data = generateSyntheticTrainingData();
    for (const example of data) {
      expect(typeof example.text).toBe('string');
      expect(example.text.length).toBeGreaterThan(0);
      expect(typeof example.label).toBe('string');
      expect(typeof example.category).toBe('string');
    }
  });
});

describe('SignalClassifier', () => {
  let classifier: SignalClassifier;

  beforeEach(() => {
    classifier = new SignalClassifier();
  });

  it('exports empty weights before training', () => {
    const weights = classifier.exportWeights();
    expect(Object.keys(weights).length).toBe(0);
  });

  it('can train on synthetic data', async () => {
    const data = generateSyntheticTrainingData().slice(0, 10);
    await classifier.train(data);

    const weights = classifier.exportWeights();
    expect(Object.keys(weights).length).toBeGreaterThan(0);
  });

  it('can load and export weights', async () => {
    const data = generateSyntheticTrainingData().slice(0, 10);
    await classifier.train(data);

    const weights = classifier.exportWeights();

    const newClassifier = new SignalClassifier();
    newClassifier.loadWeights(weights);

    const newWeights = newClassifier.exportWeights();
    expect(Object.keys(newWeights)).toEqual(Object.keys(weights));
  });

  it('throws when predicting without training', async () => {
    await expect(classifier.predict('test')).rejects.toThrow('not trained');
  });
});

describe('JointEmbeddingSpace', () => {
  let space: JointEmbeddingSpace;

  beforeEach(() => {
    space = new JointEmbeddingSpace();
  });

  it('starts empty', () => {
    const stats = space.getStats();
    expect(stats.totalSignals).toBe(0);
    expect(stats.totalClusters).toBe(0);
  });

  it('can add a signal', async () => {
    const signal = {
      type: 'correction' as const,
      what: 'User corrected the agent',
      rootCause: 'Used wrong tool',
      suggestedRule: 'Check tool first',
      confidence: 'high' as const,
      category: 'tool_use' as const,
      context: 'SSH instead of node runner',
      sessionDate: '2026-03-27',
      toolsInvolved: ['ssh'],
      filesInvolved: [],
    };

    const embedded = await space.addSignal('s1', signal);
    expect(embedded.id).toBe('s1');
    expect(embedded.embedding.length).toBe(768);

    const stats = space.getStats();
    expect(stats.totalSignals).toBe(1);
    expect(stats.totalClusters).toBe(1);
  });

  it('can export and load state', async () => {
    const signal = {
      type: 'correction' as const,
      what: 'Test signal',
      rootCause: 'Test cause',
      suggestedRule: 'Test rule',
      confidence: 'high' as const,
      category: 'tool_use' as const,
      context: 'Test context',
      sessionDate: '2026-03-27',
      toolsInvolved: [],
      filesInvolved: [],
    };

    await space.addSignal('s1', signal);
    const state = space.exportState();

    const newSpace = new JointEmbeddingSpace();
    newSpace.loadState(state);

    const stats = newSpace.getStats();
    expect(stats.totalSignals).toBe(1);
  });
});

describe('EnergyFunction', () => {
  let energy: EnergyFunction;

  beforeEach(() => {
    energy = new EnergyFunction();
  });

  it('starts untrained', () => {
    expect(energy.isTrained()).toBe(false);
  });

  it('can train on synthetic data', async () => {
    const data = generateSyntheticEnergyTrainingData();
    await energy.train(data, 10);
    expect(energy.isTrained()).toBe(true);
  });

  it('can export and load weights', async () => {
    const data = generateSyntheticEnergyTrainingData();
    await energy.train(data, 10);

    const weights = energy.exportWeights();
    expect(weights.inputHidden).toBeDefined();
    expect(weights.hiddenOutput).toBeDefined();

    const newEnergy = new EnergyFunction();
    newEnergy.loadWeights(weights);
    expect(newEnergy.isTrained()).toBe(true);
  });
});

describe('generateSyntheticEnergyTrainingData', () => {
  it('generates good and bad mutations', () => {
    const data = generateSyntheticEnergyTrainingData();

    const keeps = data.filter((d) => d.validation.verdict === 'keep');
    const rollbacks = data.filter((d) => d.validation.verdict === 'rollback');

    expect(keeps.length).toBeGreaterThan(0);
    expect(rollbacks.length).toBeGreaterThan(0);
  });
});

describe('CrossAgentStore', () => {
  let store: CrossAgentStore;

  beforeEach(() => {
    store = new CrossAgentStore();
  });

  it('starts empty', () => {
    const stats = store.getStats();
    expect(stats.totalRules).toBe(0);
  });

  it('can add a validated rule', async () => {
    const mutation = {
      id: 'M-001',
      file: 'SOUL.md' as const,
      action: 'add' as const,
      location: '## Rules',
      content: 'Always check node runner first',
      risk: 'low' as const,
      rationale: 'Reduce SSH failures',
      signalCount: 3,
      signalIds: [],
      expectedImpact: 'Fewer failures',
    };

    const validation = {
      mutationId: 'M-001',
      signalsBefore: 5,
      signalsAfter: 1,
      verdict: 'keep' as const,
      reason: 'Signals decreased',
      impactScore: 4,
      validatedAt: new Date().toISOString(),
    };

    const rule = await store.addRule('agent-a', mutation, validation);
    expect(rule.agentId).toBe('agent-a');

    const stats = store.getStats();
    expect(stats.totalRules).toBe(1);
    expect(stats.rulesByAgent['agent-a']).toBe(1);
  });

  it('rejects non-validated rules', async () => {
    const mutation = {
      id: 'M-001',
      file: 'SOUL.md' as const,
      action: 'add' as const,
      location: '## Rules',
      content: 'Test rule',
      risk: 'low' as const,
      rationale: 'Test',
      signalCount: 1,
      signalIds: [],
      expectedImpact: 'Test',
    };

    const validation = {
      mutationId: 'M-001',
      signalsBefore: 1,
      signalsAfter: 2,
      verdict: 'rollback' as const,
      reason: 'Signals increased',
      impactScore: -1,
      validatedAt: new Date().toISOString(),
    };

    await expect(store.addRule('agent-a', mutation, validation)).rejects.toThrow(
      'Only validated',
    );
  });

  it('can find transfer candidates', async () => {
    const mutation = {
      id: 'M-001',
      file: 'SOUL.md' as const,
      action: 'add' as const,
      location: '## Rules',
      content: 'Check database connection before querying',
      risk: 'low' as const,
      rationale: 'Reduce DB errors',
      signalCount: 3,
      signalIds: [],
      expectedImpact: 'Fewer failures',
    };

    const validation = {
      mutationId: 'M-001',
      signalsBefore: 5,
      signalsAfter: 1,
      verdict: 'keep' as const,
      reason: 'Signals decreased',
      impactScore: 4,
      validatedAt: new Date().toISOString(),
    };

    await store.addRule('agent-a', mutation, validation, ['database'], ['TOOLS.md']);

    const candidates = await store.findTransferCandidates(
      'database query failing',
      ['database'],
      ['TOOLS.md'],
      'agent-b', // Different agent
    );

    expect(candidates.length).toBe(1);
    expect(candidates[0].rule.agentId).toBe('agent-a');
  });
});

describe('transferToMutation', () => {
  it('converts a transfer candidate to a mutation', () => {
    const candidate = {
      rule: {
        id: 'agent-a-M-001',
        agentId: 'agent-a',
        rule: 'Check database connection first',
        embedding: mockEmbedding(),
        validation: {
          mutationId: 'M-001',
          signalsBefore: 5,
          signalsAfter: 1,
          verdict: 'keep' as const,
          reason: 'Improved',
          impactScore: 4,
          validatedAt: new Date().toISOString(),
        },
        toolsInvolved: ['database'],
        filesInvolved: ['TOOLS.md'],
        createdAt: new Date().toISOString(),
      },
      score: 0.85,
      breakdown: {
        semanticSimilarity: 0.9,
        validationScore: 0.8,
        domainOverlap: 0.8,
      },
    };

    const mutation = transferToMutation(candidate, 'SOUL.md', '## Pre-Flight Checks');

    expect(mutation.file).toBe('SOUL.md');
    expect(mutation.content).toBe('Check database connection first');
    expect(mutation.risk).toBe('medium'); // Transfer mutations are always medium risk
    expect(mutation.rationale).toContain('agent-a');
    expect(mutation.id).toMatch(/^T-/);
  });
});
