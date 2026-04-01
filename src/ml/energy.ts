/**
 * Energy-Based Mutation Ranking.
 *
 * Implements a learned energy function E(mutation, context) → score
 * where lower energy = higher confidence the mutation will help.
 *
 * Training signal: validated mutations (keep → low energy, rollback → high energy).
 */

import { getEmbedding, cosineSimilarity } from './classifier.js';
import { Mutation, Validation } from '../types.js';

export interface MutationContext {
  recentSignalTypes: string[];
  recentCategories: string[];
  targetFile: string;
  riskLevel: string;
}

export interface RankedMutation {
  mutation: Mutation;
  energy: number;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Simple MLP for energy scoring.
 * Uses a single hidden layer for interpretability.
 */
class MLP {
  private weightsInputHidden: number[][];
  private biasHidden: number[];
  private weightsHiddenOutput: number[];
  private biasOutput: number;

  constructor(
    inputDim: number,
    hiddenDim: number = 64,
    seed: number = 42,
  ) {
    // Seeded PRNG for reproducible initialisation
    let s = seed;
    const seededRandom = (): number => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return (s >>> 0) / 0xffffffff;
    };

    // Xavier initialisation
    const scale1 = Math.sqrt(2.0 / (inputDim + hiddenDim));
    const scale2 = Math.sqrt(2.0 / (hiddenDim + 1));

    this.weightsInputHidden = Array(hiddenDim)
      .fill(0)
      .map(() =>
        Array(inputDim)
          .fill(0)
          .map(() => (seededRandom() - 0.5) * 2 * scale1),
      );
    this.biasHidden = Array(hiddenDim).fill(0);
    this.weightsHiddenOutput = Array(hiddenDim)
      .fill(0)
      .map(() => (seededRandom() - 0.5) * 2 * scale2);
    this.biasOutput = 0;
  }

  private relu(x: number): number {
    return Math.max(0, x);
  }

  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  forward(input: number[]): number {
    // Hidden layer with ReLU
    const hidden = this.weightsInputHidden.map((weights, i) => {
      const sum = weights.reduce((acc, w, j) => acc + w * input[j], 0);
      return this.relu(sum + this.biasHidden[i]);
    });

    // Output layer with sigmoid (energy in [0, 1])
    const output = this.weightsHiddenOutput.reduce(
      (acc, w, i) => acc + w * hidden[i],
      0,
    );
    return this.sigmoid(output + this.biasOutput);
  }

  /**
   * Gradient descent training step with L2 regularization.
   */
  trainStep(input: number[], target: number, lr: number = 0.01, weightDecay: number = 1e-4): number {
    // Forward pass
    const hidden = this.weightsInputHidden.map((weights, i) => {
      const sum = weights.reduce((acc, w, j) => acc + w * input[j], 0);
      return { pre: sum + this.biasHidden[i], post: this.relu(sum + this.biasHidden[i]) };
    });

    const outputPre =
      this.weightsHiddenOutput.reduce((acc, w, i) => acc + w * hidden[i].post, 0) +
      this.biasOutput;
    const output = this.sigmoid(outputPre);

    // Loss (MSE)
    const loss = 0.5 * (output - target) ** 2;

    // Backward pass
    const dOutput = (output - target) * output * (1 - output); // sigmoid derivative

    // Gradients for output layer
    const dWeightsHiddenOutput = hidden.map((h) => dOutput * h.post);
    const dBiasOutput = dOutput;

    // Gradients for hidden layer
    const dHidden = this.weightsHiddenOutput.map(
      (w, i) => dOutput * w * (hidden[i].pre > 0 ? 1 : 0), // ReLU derivative
    );

    const dWeightsInputHidden = this.weightsInputHidden.map((_, i) =>
      input.map((x) => dHidden[i] * x),
    );
    const dBiasHidden = dHidden;

    // Update weights with L2 regularization (weight decay)
    for (let i = 0; i < this.weightsHiddenOutput.length; i++) {
      this.weightsHiddenOutput[i] -= lr * (dWeightsHiddenOutput[i] + weightDecay * this.weightsHiddenOutput[i]);
    }
    this.biasOutput -= lr * dBiasOutput;

    for (let i = 0; i < this.weightsInputHidden.length; i++) {
      for (let j = 0; j < this.weightsInputHidden[i].length; j++) {
        this.weightsInputHidden[i][j] -= lr * (dWeightsInputHidden[i][j] + weightDecay * this.weightsInputHidden[i][j]);
      }
      this.biasHidden[i] -= lr * dBiasHidden[i];
    }

    return loss;
  }

  exportWeights(): {
    inputHidden: number[][];
    biasHidden: number[];
    hiddenOutput: number[];
    biasOutput: number;
  } {
    return {
      inputHidden: this.weightsInputHidden,
      biasHidden: this.biasHidden,
      hiddenOutput: this.weightsHiddenOutput,
      biasOutput: this.biasOutput,
    };
  }

  loadWeights(weights: ReturnType<typeof this.exportWeights>): void {
    this.weightsInputHidden = weights.inputHidden;
    this.biasHidden = weights.biasHidden;
    this.weightsHiddenOutput = weights.hiddenOutput;
    this.biasOutput = weights.biasOutput;
  }
}

/**
 * Energy function for ranking mutations.
 */
export class EnergyFunction {
  private mlp: MLP;
  private embeddingDim: number;
  private trained: boolean = false;

  constructor(embeddingDim: number = 768) {
    this.embeddingDim = embeddingDim;
    // Input: 10 text features + 19 context features = 29
    this.mlp = new MLP(29, 64);
  }

  /**
   * Encode context as a feature vector.
   */
  private encodeContext(context: MutationContext): number[] {
    const signalTypes = ['correction', 'failure', 'takeover', 'frustration', 'style', 'success'];
    const categories = ['tool_use', 'knowledge', 'style', 'judgment', 'speed', 'memory'];
    const files = ['SOUL.md', 'TOOLS.md', 'AGENTS.md', 'HEARTBEAT.md'];
    const risks = ['low', 'medium', 'high'];

    const features: number[] = [];

    // One-hot encode signal types (count-based)
    for (const type of signalTypes) {
      features.push(context.recentSignalTypes.filter((t) => t === type).length / 10);
    }

    // One-hot encode categories (count-based)
    for (const cat of categories) {
      features.push(context.recentCategories.filter((c) => c === cat).length / 10);
    }

    // One-hot encode target file
    for (const file of files) {
      features.push(context.targetFile === file ? 1 : 0);
    }

    // One-hot encode risk level
    for (const risk of risks) {
      features.push(context.riskLevel === risk ? 1 : 0);
    }

    return features;
  }

  /**
   * Score a mutation (lower = better).
   */
  async score(mutation: Mutation, context: MutationContext): Promise<number> {
    const textFeatures = this.encodeText(mutation);
    const contextFeatures = this.encodeContext(context);
    const input = [...textFeatures, ...contextFeatures];

    return this.mlp.forward(input);
  }

  /**
   * Extract text-based features from a mutation (no embeddings needed).
   */
  private encodeText(mutation: Mutation): number[] {
    const text = `${mutation.content} ${mutation.rationale}`;
    const lower = text.toLowerCase();
    return [
      // Length features
      Math.min(text.length / 200, 1), // normalised length
      (text.match(/\b\w+\b/g) || []).length / 30, // word count normalised

      // Specificity signals (specific > vague)
      /\b(always|never|before|after|every|must)\b/i.test(text) ? 1 : 0,
      /\b(sometimes|maybe|try|consider|might)\b/i.test(text) ? 1 : 0, // vagueness
      /\b(check|verify|confirm|validate|ensure)\b/i.test(text) ? 1 : 0, // actionable verbs
      /\d+/.test(text) ? 1 : 0, // contains numbers (specific)

      // Risk signals
      mutation.risk === 'low' ? 0 : mutation.risk === 'medium' ? 0.5 : 1,
      mutation.signalCount / 10, // normalised signal count

      // Action type
      mutation.action === 'add' ? 0 : mutation.action === 'modify' ? 0.5 : 1,

      // File importance
      mutation.file === 'SOUL.md' ? 1 : mutation.file === 'AGENTS.md' ? 0.8 :
        mutation.file === 'HEARTBEAT.md' ? 0.6 : 0.4,
    ];
  }

  /**
   * Train on validated mutations.
   */
  async train(
    trainingData: Array<{
      mutation: Mutation;
      context: MutationContext;
      validation: Validation;
    }>,
    epochs: number = 100,
  ): Promise<{ finalLoss: number }> {
    // Prepare training examples
    const examples: Array<{ input: number[]; target: number }> = [];

    for (const { mutation, context, validation } of trainingData) {
      const textFeatures = this.encodeText(mutation);
      const contextFeatures = this.encodeContext(context);
      const input = [...textFeatures, ...contextFeatures];

      // Target: 0 for keep (good), 1 for rollback (bad), 0.5 for extend (uncertain)
      const target =
        validation.verdict === 'keep'
          ? 0.0
          : validation.verdict === 'rollback'
            ? 1.0
            : 0.5;

      examples.push({ input, target });
    }

    // Train with cosine learning rate decay and early stopping
    const baseLR = 0.01;
    const patience = 15;
    let bestLoss = Infinity;
    let staleEpochs = 0;
    let totalLoss = 0;

    for (let epoch = 0; epoch < epochs; epoch++) {
      totalLoss = 0;
      // Cosine annealing learning rate
      const lr = baseLR * 0.5 * (1 + Math.cos(Math.PI * epoch / epochs));

      // Fisher-Yates shuffle (unbiased)
      const shuffled = [...examples];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }

      for (const { input, target } of shuffled) {
        totalLoss += this.mlp.trainStep(input, target, lr);
      }

      const avgLoss = totalLoss / examples.length;

      if (epoch % 10 === 0) {
        console.log(`Epoch ${epoch}: loss = ${avgLoss.toFixed(4)}, lr = ${lr.toFixed(5)}`);
      }

      // Early stopping
      if (avgLoss < bestLoss - 1e-6) {
        bestLoss = avgLoss;
        staleEpochs = 0;
      } else {
        staleEpochs++;
        if (staleEpochs >= patience) {
          console.log(`Early stopping at epoch ${epoch} (loss plateau: ${avgLoss.toFixed(4)})`);
          break;
        }
      }
    }

    this.trained = true;
    return { finalLoss: totalLoss / examples.length };
  }

  /**
   * Rank mutations by energy (lowest first).
   */
  async rank(
    mutations: Mutation[],
    context: MutationContext,
  ): Promise<RankedMutation[]> {
    const scored = await Promise.all(
      mutations.map(async (m) => ({
        mutation: m,
        energy: await this.score(m, context),
      })),
    );

    scored.sort((a, b) => a.energy - b.energy);

    return scored.map((s) => ({
      ...s,
      confidence:
        s.energy < 0.3 ? 'high' : s.energy < 0.6 ? 'medium' : 'low',
    }));
  }

  /**
   * Check if trained.
   */
  isTrained(): boolean {
    return this.trained;
  }

  /**
   * Export weights.
   */
  exportWeights(): ReturnType<MLP['exportWeights']> {
    return this.mlp.exportWeights();
  }

  /**
   * Load weights.
   */
  loadWeights(weights: ReturnType<MLP['exportWeights']>): void {
    this.mlp.loadWeights(weights);
    this.trained = true;
  }
}

/**
 * Generate synthetic training data for cold start.
 */
export function generateSyntheticEnergyTrainingData(): Array<{
  mutation: Mutation;
  context: MutationContext;
  validation: Validation;
}> {
  const data: Array<{
    mutation: Mutation;
    context: MutationContext;
    validation: Validation;
  }> = [];

  // Good mutations (keep) — balanced with bad mutations for better training
  const goodMutations = [
    {
      content: 'Before running remote commands, check if the node runner is available',
      rationale: 'Agent used SSH 5 times when node runner was available',
      signalsBefore: 5,
      signalsAfter: 1,
      file: 'SOUL.md' as const,
      risk: 'low' as const,
      category: 'tool_use',
    },
    {
      content: 'Query the database directly instead of asking the user for data',
      rationale: 'Agent asked user for data that was already in the database 4 times',
      signalsBefore: 4,
      signalsAfter: 0,
      file: 'SOUL.md' as const,
      risk: 'low' as const,
      category: 'tool_use',
    },
    {
      content: 'Use British English spellings in all documentation and comments',
      rationale: 'User corrected American spellings 3 times',
      signalsBefore: 3,
      signalsAfter: 0,
      file: 'SOUL.md' as const,
      risk: 'low' as const,
      category: 'style',
    },
    {
      content: 'When a tool fails with a timeout, wait 5 seconds before retrying',
      rationale: 'Agent retried failed tools immediately causing cascading failures',
      signalsBefore: 6,
      signalsAfter: 1,
      file: 'TOOLS.md' as const,
      risk: 'medium' as const,
      category: 'tool_use',
    },
    {
      content: 'Present search results as a numbered list with source links',
      rationale: 'User reformatted search output 4 times into numbered lists',
      signalsBefore: 4,
      signalsAfter: 0,
      file: 'SOUL.md' as const,
      risk: 'low' as const,
      category: 'style',
    },
    {
      content: 'Always confirm before deleting files or modifying permissions',
      rationale: 'User expressed frustration 3 times after destructive actions',
      signalsBefore: 3,
      signalsAfter: 0,
      file: 'AGENTS.md' as const,
      risk: 'medium' as const,
      category: 'judgment',
    },
    {
      content: 'Check git status before making commits to avoid including untracked files',
      rationale: 'Agent committed untracked files twice, user had to reset',
      signalsBefore: 2,
      signalsAfter: 0,
      file: 'TOOLS.md' as const,
      risk: 'low' as const,
      category: 'tool_use',
    },
  ];

  for (const { content, rationale, signalsBefore, signalsAfter, file, risk, category } of goodMutations) {
    data.push({
      mutation: {
        id: `M-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        file,
        action: 'add',
        location: '## Pre-Flight Checks',
        content,
        risk,
        rationale,
        signalCount: signalsBefore,
        signalIds: [],
        expectedImpact: 'Reduce corrections',
      },
      context: {
        recentSignalTypes: Array(signalsBefore).fill('correction'),
        recentCategories: Array(signalsBefore).fill(category),
        targetFile: file,
        riskLevel: risk,
      },
      validation: {
        mutationId: '',
        signalsBefore,
        signalsAfter,
        verdict: 'keep',
        reason: 'Signals decreased',
        impactScore: signalsBefore - signalsAfter,
        validatedAt: new Date().toISOString(),
      },
    });
  }

  // Bad mutations (rollback) — balanced count with good mutations
  const badMutations = [
    {
      content: 'When asked about Project X, the budget is $50k',
      rationale: 'User mentioned Project X budget once',
      signalsBefore: 1,
      signalsAfter: 2,
      file: 'TOOLS.md' as const,
      risk: 'low' as const,
    },
    {
      content: 'Always use verbose output',
      rationale: 'User wanted verbose output once',
      signalsBefore: 1,
      signalsAfter: 3,
      file: 'SOUL.md' as const,
      risk: 'low' as const,
    },
    {
      content: 'Never ask clarifying questions, always infer intent',
      rationale: 'User seemed annoyed by a question once',
      signalsBefore: 1,
      signalsAfter: 5,
      file: 'SOUL.md' as const,
      risk: 'high' as const,
    },
    {
      content: 'Use Python instead of TypeScript for all scripts',
      rationale: 'User used Python in one unrelated task',
      signalsBefore: 1,
      signalsAfter: 4,
      file: 'TOOLS.md' as const,
      risk: 'medium' as const,
    },
    {
      content: 'Skip tests when making small changes to save time',
      rationale: 'User skipped tests once on a trivial change',
      signalsBefore: 0,
      signalsAfter: 3,
      file: 'AGENTS.md' as const,
      risk: 'high' as const,
    },
    {
      content: 'Respond with maximum detail including all edge cases',
      rationale: 'User asked for detail once on a complex topic',
      signalsBefore: 1,
      signalsAfter: 4,
      file: 'SOUL.md' as const,
      risk: 'low' as const,
    },
    {
      content: 'Cache API credentials in the heartbeat for faster access',
      rationale: 'Agent was slow authenticating twice',
      signalsBefore: 2,
      signalsAfter: 2,
      file: 'HEARTBEAT.md' as const,
      risk: 'high' as const,
    },
  ];

  for (const { content, rationale, signalsBefore, signalsAfter, file, risk } of badMutations) {
    data.push({
      mutation: {
        id: `M-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        file,
        action: 'add',
        location: '## Notes',
        content,
        risk,
        rationale,
        signalCount: signalsBefore,
        signalIds: [],
        expectedImpact: 'Reduce corrections',
      },
      context: {
        recentSignalTypes: Array(Math.max(signalsBefore, 1)).fill('correction'),
        recentCategories: Array(Math.max(signalsBefore, 1)).fill('knowledge'),
        targetFile: file,
        riskLevel: risk,
      },
      validation: {
        mutationId: '',
        signalsBefore,
        signalsAfter,
        verdict: 'rollback',
        reason: 'Signals increased or unchanged',
        impactScore: signalsBefore - signalsAfter,
        validatedAt: new Date().toISOString(),
      },
    });
  }

  return data;
}
