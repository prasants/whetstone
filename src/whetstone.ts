/**
 * Whetstone — The complete self-improvement system.
 *
 * Orchestrates signal detection, mutation, validation, and transfer
 * using the ML components.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { loadConfig, saveConfig, ensureDirectories } from './config.js';
import { snapshotFiles, rollbackFromSnapshot, checkMutationSafety } from './safety.js';
import { applyMutation, generateMutationId } from './mutate.js';
import { buildValidation, computeVerdict } from './validate.js';
import {
  Signal,
  Mutation,
  Validation,
  WhetstoneConfig,
  DEFAULT_CONFIG,
} from './types.js';
import {
  SignalClassifier,
  JointEmbeddingSpace,
  EnergyFunction,
  CrossAgentStore,
  generateSyntheticTrainingData,
  generateSyntheticEnergyTrainingData,
  transferToMutation,
} from './ml/index.js';

export interface WhetstoneState {
  classifier: ReturnType<SignalClassifier['exportWeights']> | null;
  embeddings: ReturnType<JointEmbeddingSpace['exportState']> | null;
  energy: ReturnType<EnergyFunction['exportWeights']> | null;
  transfer: ReturnType<CrossAgentStore['exportState']> | null;
  signals: Array<{ id: string; signal: Signal; createdAt: string }>;
  mutations: Array<{ mutation: Mutation; appliedAt: string }>;
  validations: Validation[];
}

/**
 * Main Whetstone class.
 */
export class Whetstone {
  private workspace: string;
  private config: WhetstoneConfig;
  private classifier: SignalClassifier;
  private embeddings: JointEmbeddingSpace;
  private energy: EnergyFunction;
  private transfer: CrossAgentStore;
  private agentId: string;

  private signals: Array<{ id: string; signal: Signal; createdAt: string }> = [];
  private mutations: Array<{ mutation: Mutation; appliedAt: string }> = [];
  private validations: Validation[] = [];

  constructor(workspace: string, agentId: string = 'default') {
    this.workspace = workspace;
    this.agentId = agentId;
    this.config = loadConfig(workspace);

    this.classifier = new SignalClassifier();
    this.embeddings = new JointEmbeddingSpace();
    this.energy = new EnergyFunction();
    this.transfer = new CrossAgentStore();
  }

  /**
   * Initialise Whetstone (create directories, load state, train if needed).
   */
  async init(): Promise<void> {
    ensureDirectories(this.workspace);

    // Load existing state if available
    const statePath = resolve(this.workspace, '.whetstone', 'state.json');
    if (existsSync(statePath)) {
      const state = JSON.parse(readFileSync(statePath, 'utf8')) as WhetstoneState;
      this.loadState(state);
    }

    // Train classifier if not trained
    if (!this.classifierTrained()) {
      console.log('[whetstone] Training signal classifier...');
      await this.trainClassifier();
    }

    // Train energy function if not trained
    if (!this.energy.isTrained()) {
      console.log('[whetstone] Training energy function...');
      await this.trainEnergyFunction();
    }
  }

  /**
   * Train the signal classifier.
   */
  async trainClassifier(): Promise<void> {
    const trainingData = generateSyntheticTrainingData();
    console.log(`[whetstone] Training classifier on ${trainingData.length} examples...`);
    await this.classifier.train(trainingData);
    console.log('[whetstone] Classifier trained.');
  }

  /**
   * Train the energy function.
   */
  async trainEnergyFunction(): Promise<void> {
    // Use real data if available, otherwise synthetic
    let trainingData = generateSyntheticEnergyTrainingData();

    // Add any real validation data we have
    for (const validation of this.validations) {
      const mutation = this.mutations.find(
        (m) => m.mutation.id === validation.mutationId,
      );
      if (mutation) {
        trainingData.push({
          mutation: mutation.mutation,
          context: {
            recentSignalTypes: this.signals
              .slice(-10)
              .map((s) => s.signal.type),
            recentCategories: this.signals
              .slice(-10)
              .map((s) => s.signal.category),
            targetFile: mutation.mutation.file,
            riskLevel: mutation.mutation.risk,
          },
          validation,
        });
      }
    }

    console.log(
      `[whetstone] Training energy function on ${trainingData.length} examples...`,
    );
    const result = await this.energy.train(trainingData, 50);
    console.log(`[whetstone] Energy function trained. Final loss: ${result.finalLoss.toFixed(4)}`);
  }

  /**
   * Detect signals in a message using the classifier.
   */
  async detectSignal(
    message: string,
    context: string = '',
  ): Promise<Signal | null> {
    const prediction = await this.classifier.predict(message);

    if (!prediction) {
      return null;
    }

    // Build signal from prediction
    const signal: Signal = {
      type: prediction.type,
      what: message.substring(0, 100),
      rootCause: 'Detected by classifier',
      suggestedRule: '',
      confidence: prediction.confidence,
      category: prediction.category,
      context: context.substring(0, 150),
      sessionDate: new Date().toISOString().split('T')[0],
      toolsInvolved: [],
      filesInvolved: [],
    };

    return signal;
  }

  /**
   * Add a signal to the system.
   */
  async addSignal(signal: Signal): Promise<string> {
    const id = `S-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

    this.signals.push({
      id,
      signal,
      createdAt: new Date().toISOString(),
    });

    // Add to embedding space
    await this.embeddings.addSignal(id, signal);

    // Persist state
    this.saveState();

    return id;
  }

  /**
   * Get mutation candidates (clusters with enough signals).
   */
  getMutationCandidates(): ReturnType<JointEmbeddingSpace['getMutationCandidates']> {
    return this.embeddings.getMutationCandidates(this.config.minSignalsForMutation);
  }

  /**
   * Rank proposed mutations using the energy function.
   */
  async rankMutations(mutations: Mutation[]): Promise<Mutation[]> {
    const context = {
      recentSignalTypes: this.signals.slice(-10).map((s) => s.signal.type),
      recentCategories: this.signals.slice(-10).map((s) => s.signal.category),
      targetFile: mutations[0]?.file || 'SOUL.md',
      riskLevel: 'low',
    };

    const ranked = await this.energy.rank(mutations, context);
    return ranked.map((r) => r.mutation);
  }

  /**
   * Apply a mutation with safety checks.
   */
  applyMutation(mutation: Mutation): ReturnType<typeof applyMutation> {
    const result = applyMutation(mutation, this.workspace, this.config);

    if (result.applied) {
      this.mutations.push({
        mutation,
        appliedAt: new Date().toISOString(),
      });
      this.saveState();
    }

    return result;
  }

  /**
   * Validate a mutation.
   */
  validateMutation(
    mutationId: string,
    signalsBefore: number,
    signalsAfter: number,
  ): Validation {
    const mutation = this.mutations.find((m) => m.mutation.id === mutationId);
    if (!mutation) {
      throw new Error(`Mutation ${mutationId} not found`);
    }

    const validation = buildValidation(
      mutation.mutation,
      signalsBefore,
      signalsAfter,
    );

    this.validations.push(validation);

    // If validated as effective, add to cross-agent transfer
    if (validation.verdict === 'keep') {
      this.transfer.addRule(
        this.agentId,
        mutation.mutation,
        validation,
        [], // toolsInvolved
        [mutation.mutation.file], // filesInvolved
      );
    }

    this.saveState();
    return validation;
  }

  /**
   * Get transfer candidates for the current context.
   */
  async getTransferCandidates(
    context: string,
    tools: string[] = [],
    files: string[] = [],
  ): Promise<ReturnType<CrossAgentStore['findTransferCandidates']>> {
    return this.transfer.findTransferCandidates(
      context,
      tools,
      files,
      this.agentId, // Exclude own rules
      5,
    );
  }

  /**
   * Create a snapshot before mutations.
   */
  snapshot(): string {
    return snapshotFiles(this.workspace, this.config);
  }

  /**
   * Rollback to a snapshot.
   */
  rollback(snapshotDir: string): ReturnType<typeof rollbackFromSnapshot> {
    return rollbackFromSnapshot(this.workspace, snapshotDir, this.config);
  }

  /**
   * Get statistics.
   */
  getStats(): {
    totalSignals: number;
    totalMutations: number;
    totalValidations: number;
    mutationsKept: number;
    mutationsRolledBack: number;
    clusterStats: ReturnType<JointEmbeddingSpace['getStats']>;
    transferStats: ReturnType<CrossAgentStore['getStats']>;
  } {
    const kept = this.validations.filter((v) => v.verdict === 'keep').length;
    const rolledBack = this.validations.filter(
      (v) => v.verdict === 'rollback',
    ).length;

    return {
      totalSignals: this.signals.length,
      totalMutations: this.mutations.length,
      totalValidations: this.validations.length,
      mutationsKept: kept,
      mutationsRolledBack: rolledBack,
      clusterStats: this.embeddings.getStats(),
      transferStats: this.transfer.getStats(),
    };
  }

  /**
   * Check if classifier is trained.
   */
  private classifierTrained(): boolean {
    try {
      const weights = this.classifier.exportWeights();
      return Object.keys(weights).length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Save state to disk.
   */
  private saveState(): void {
    const state: WhetstoneState = {
      classifier: this.classifierTrained()
        ? this.classifier.exportWeights()
        : null,
      embeddings: this.embeddings.exportState(),
      energy: this.energy.isTrained() ? this.energy.exportWeights() : null,
      transfer: this.transfer.exportState(),
      signals: this.signals,
      mutations: this.mutations,
      validations: this.validations,
    };

    const statePath = resolve(this.workspace, '.whetstone', 'state.json');
    writeFileSync(statePath, JSON.stringify(state, null, 2));
  }

  /**
   * Load state from disk.
   */
  private loadState(state: WhetstoneState): void {
    if (state.classifier) {
      this.classifier.loadWeights(state.classifier);
    }
    if (state.embeddings) {
      this.embeddings.loadState(state.embeddings);
    }
    if (state.energy) {
      this.energy.loadWeights(state.energy);
    }
    if (state.transfer) {
      this.transfer.loadState(state.transfer);
    }
    this.signals = state.signals || [];
    this.mutations = state.mutations || [];
    this.validations = state.validations || [];
  }
}
