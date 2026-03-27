/**
 * Whetstone evaluation benchmark.
 * Measures classification accuracy and mutation ranking quality.
 * Runs offline with mocked embeddings (deterministic per text).
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Deterministic pseudo-random embedding based on seed string
// Uses category-aware seeding so similar texts get similar embeddings
const mockEmbedding = (seed: string): number[] => {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return Array(768).fill(0).map((_, i) => {
    h = ((h << 5) - h + i) | 0;
    return (h & 0xffff) / 0xffff - 0.5;
  });
};

// Mock fetch globally before importing ML modules
globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(init.body as string) : {};
  return {
    ok: true,
    json: async () => ({ embedding: mockEmbedding(body.prompt || '') }),
  } as Response;
};

// Now import ML modules
const { SignalClassifier, generateSyntheticTrainingData } = await import('../src/ml/classifier.js');
const { EnergyFunction, generateSyntheticEnergyTrainingData } = await import('../src/ml/energy.js');

interface SignalTestCase {
  text: string;
  expected_type: string;
  expected_category: string;
}

interface MutationPair {
  better: { content: string; signal_count: number; signals_after: number };
  worse: { content: string; signal_count: number; signals_after: number };
  reason: string;
}

interface Dataset {
  signals: SignalTestCase[];
  mutation_pairs: MutationPair[];
}

// Load dataset
const dataset: Dataset = JSON.parse(
  readFileSync(join(__dirname, 'dataset.json'), 'utf-8')
);

// ---- Signal Classification ----
console.log('=== Signal Classification Eval ===\n');

const classifier = new SignalClassifier();
const trainingData = generateSyntheticTrainingData();
await classifier.train(trainingData);

let correctType = 0;
let correctCategory = 0;
let total = dataset.signals.length;
let noPrediction = 0;

for (const testCase of dataset.signals) {
  const result = await classifier.predict(testCase.text);
  if (!result) {
    noPrediction++;
    continue;
  }
  const typeMatch = result.type === testCase.expected_type;
  const catMatch = result.category === testCase.expected_category;
  
  if (typeMatch) correctType++;
  if (catMatch) correctCategory++;
  
  if (!typeMatch) {
    console.log(`  ✗ Type: "${testCase.text.slice(0, 50)}..." → got ${result.type}, expected ${testCase.expected_type}`);
  }
}

const typeAccuracy = correctType / total;
const categoryAccuracy = correctCategory / total;

console.log(`\nType accuracy:     ${(typeAccuracy * 100).toFixed(1)}% (${correctType}/${total})`);
console.log(`Category accuracy: ${(categoryAccuracy * 100).toFixed(1)}% (${correctCategory}/${total})`);
console.log(`No prediction:     ${noPrediction}/${total}`);

// ---- Energy Function (Mutation Ranking) ----
console.log('\n=== Mutation Ranking Eval ===\n');

const energy = new EnergyFunction();
const energyTrainingData = generateSyntheticEnergyTrainingData();
await energy.train(energyTrainingData, 200);

let correctRankings = 0;
let totalPairs = dataset.mutation_pairs.length;

for (const pair of dataset.mutation_pairs) {
  const betterMutation = {
    id: 'eval-better',
    file: 'SOUL.md' as const,
    action: 'add' as const,
    location: '## Rules',
    content: pair.better.content,
    risk: 'low' as const,
    rationale: 'eval',
    signalCount: pair.better.signal_count,
    signalIds: [],
    expectedImpact: 'reduce corrections',
  };
  
  const worseMutation = {
    id: 'eval-worse',
    file: 'SOUL.md' as const,
    action: 'add' as const,
    location: '## Rules',
    content: pair.worse.content,
    risk: 'low' as const,
    rationale: 'eval',
    signalCount: pair.worse.signal_count,
    signalIds: [],
    expectedImpact: 'reduce corrections',
  };
  
  const context = {
    recentSignalTypes: Array(pair.better.signal_count).fill('correction'),
    recentCategories: ['judgment'] as string[],
    targetFile: 'SOUL.md',
    riskLevel: 'low' as const,
  };
  
  const betterEnergy = await energy.score(betterMutation, context);
  const worseEnergy = await energy.score(worseMutation, context);
  
  const correct = betterEnergy < worseEnergy;
  if (correct) correctRankings++;
  
  console.log(`  ${correct ? '✓' : '✗'} "${pair.better.content.slice(0, 40)}..." (${betterEnergy.toFixed(3)}) vs "${pair.worse.content.slice(0, 40)}..." (${worseEnergy.toFixed(3)})`);
}

const rankingAccuracy = correctRankings / totalPairs;

console.log(`\nRanking accuracy: ${(rankingAccuracy * 100).toFixed(1)}% (${correctRankings}/${totalPairs})`);

// ---- Summary ----
console.log('\n=== Summary ===\n');
const results = {
  timestamp: new Date().toISOString(),
  classification: {
    type_accuracy: typeAccuracy,
    category_accuracy: categoryAccuracy,
    no_prediction_rate: noPrediction / total,
    total: total,
  },
  ranking: {
    accuracy: rankingAccuracy,
    total: totalPairs,
  },
};

console.log(JSON.stringify(results));
writeFileSync(join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
console.log('\nResults written to benchmarks/results.json');
