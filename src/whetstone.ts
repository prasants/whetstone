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
  ThoughtLayerClient,
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
import { TraceRecorder, TaskOutcome, ToolStatus } from './recorder.js';
import { ExecutionAnalyser, AnalysisResult } from './analyser.js';
import { SkillEvolver, EvolutionSuggestion, EvolutionRecord } from './evolution.js';

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

  // Execution recording + analysis + evolution
  public recorder: TraceRecorder;
  public analyser: ExecutionAnalyser;
  public evolver: SkillEvolver;

  // Optional ThoughtLayer integration (install `thoughtlayer` package to enable)
  private thoughtlayer: ThoughtLayerClient | null = null;
  private thoughtlayerDomain: string = 'whetstone';

  constructor(workspace: string, agentId: string = 'default', thoughtlayer?: ThoughtLayerClient) {
    this.workspace = workspace;
    this.agentId = agentId;
    this.config = loadConfig(workspace);

    this.classifier = new SignalClassifier();
    this.embeddings = new JointEmbeddingSpace();
    this.energy = new EnergyFunction();
    this.transfer = new CrossAgentStore();

    // Execution recording + analysis + evolution
    this.recorder = new TraceRecorder(workspace);
    this.analyser = new ExecutionAnalyser(workspace, this.recorder);
    this.evolver = new SkillEvolver(workspace);

    // ThoughtLayer integration (optional)
    if (thoughtlayer) {
      this.thoughtlayer = thoughtlayer;
      this.thoughtlayerDomain = this.config.thoughtlayer?.domain || this.config.thoughtlayerDomain || 'whetstone';
      console.log(`[whetstone] ThoughtLayer integration enabled (domain: ${this.thoughtlayerDomain})`);
    }
  }

  /**
   * Factory: create Whetstone with ThoughtLayer if available and configured.
   *
   * Dynamically imports the `thoughtlayer` package. If the package is not
   * installed or config.thoughtlayer.enabled is false, returns a standard
   * Whetstone instance without ThoughtLayer.
   */
  static async withThoughtLayer(workspace: string, agentId: string = 'default'): Promise<Whetstone> {
    const config = loadConfig(workspace);
    const tlConfig = config.thoughtlayer;

    if (!tlConfig?.enabled) {
      return new Whetstone(workspace, agentId);
    }

    try {
      // Dynamic import — works even if thoughtlayer is not installed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tlModule = await (Function('return import("thoughtlayer")')() as Promise<any>);
      const ThoughtLayer = tlModule.ThoughtLayer || tlModule.default?.ThoughtLayer;
      if (!ThoughtLayer) throw new Error('ThoughtLayer class not found in module');

      const projectRoot = tlConfig.projectRoot || workspace;
      const tl = new ThoughtLayer({ projectRoot });
      const domain = tlConfig.domain || config.thoughtlayerDomain || 'whetstone';

      // Adapt ThoughtLayer to ThoughtLayerClient interface
      const client: ThoughtLayerClient = {
        async add(entry) {
          const result = await tl.curate(entry.content, {
            domain: entry.domain,
            title: entry.title,
            metadata: entry.metadata,
          });
          return { id: result?.id || `tl-${Date.now()}` };
        },
        async query(query, topK = 10) {
          const results = await tl.retrieve(query, { topK, domain });
          return (results || []).map((r: Record<string, unknown>) => ({
            id: r.id as string,
            title: r.title as string,
            content: r.content as string,
            score: r.score as number,
            domain,
          }));
        },
        async list(d) {
          const results = await tl.retrieve('*', { topK: 100, domain: d || domain });
          return (results || []).map((r: Record<string, unknown>) => ({
            id: r.id as string,
            domain: d || domain,
            title: r.title as string,
            content: r.content as string,
          }));
        },
      };

      console.log(`[whetstone] ThoughtLayer connected (project: ${projectRoot}, domain: ${domain})`);
      return new Whetstone(workspace, agentId, client);
    } catch (err) {
      console.warn('[whetstone] ThoughtLayer package not available, continuing without it:', (err as Error).message);
      return new Whetstone(workspace, agentId);
    }
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

    // Add any real validation data we have (O(1) lookup via Map)
    const mutationMap = new Map(this.mutations.map((m) => [m.mutation.id, m]));
    for (const validation of this.validations) {
      const mutation = mutationMap.get(validation.mutationId);
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
    const createdAt = new Date().toISOString();

    this.signals.push({ id, signal, createdAt });

    // Add to embedding space
    await this.embeddings.addSignal(id, signal);

    // Persist to ThoughtLayer if available
    if (this.thoughtlayer) {
      try {
        await this.thoughtlayer.add({
          domain: this.thoughtlayerDomain,
          title: `[signal] ${signal.type}: ${signal.context?.substring(0, 80) || 'no context'}`,
          content: JSON.stringify(signal),
          metadata: { signalId: id, type: signal.type, category: signal.category, confidence: signal.confidence, createdAt },
        });
      } catch (err) {
        console.warn(`[whetstone] Failed to persist signal to ThoughtLayer: ${(err as Error).message}`);
      }
    }

    // Persist local state
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
      const appliedAt = new Date().toISOString();
      this.mutations.push({ mutation, appliedAt });

      // Persist to ThoughtLayer if available
      if (this.thoughtlayer) {
        this.thoughtlayer.add({
          domain: this.thoughtlayerDomain,
          title: `[mutation] ${mutation.id}: ${mutation.rationale.substring(0, 80)}`,
          content: JSON.stringify({ mutation, result: { applied: true }, appliedAt }),
          metadata: { mutationId: mutation.id, file: mutation.file, risk: mutation.risk, action: mutation.action },
        }).catch((err) => console.warn(`[whetstone] Failed to persist mutation to ThoughtLayer: ${(err as Error).message}`));
      }

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

    // Persist to ThoughtLayer if available
    if (this.thoughtlayer) {
      this.thoughtlayer.add({
        domain: this.thoughtlayerDomain,
        title: `[validation] ${mutationId}: ${validation.verdict}`,
        content: JSON.stringify(validation),
        metadata: { mutationId, verdict: validation.verdict, impactScore: validation.impactScore },
      }).catch((err) => console.warn(`[whetstone] Failed to persist validation to ThoughtLayer: ${(err as Error).message}`));
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

  // ── Execution Recording ──────────────────────────────────────

  /**
   * Start recording a task.
   */
  startRecording(taskId: string, description: string): void {
    this.recorder.start(taskId, description, this.agentId);
  }

  /**
   * Record a tool call outcome.
   */
  recordTool(taskId: string, tool: string, status: ToolStatus, detail?: string, durationMs?: number): void {
    this.recorder.tool(taskId, tool, status, detail || '', durationMs);
  }

  /**
   * Record an error.
   */
  recordError(taskId: string, tool: string, error: string): void {
    this.recorder.error(taskId, tool, error);
  }

  /**
   * End recording and trigger analysis.
   */
  async endRecording(taskId: string, outcome: TaskOutcome, summary?: string): Promise<AnalysisResult | null> {
    this.recorder.end(taskId, outcome, summary || '');

    // Auto-analyse
    const analysis = this.analyser.analyse(taskId);

    if (analysis) {
      // Add extracted signals to the system
      for (const signal of analysis.signals) {
        await this.addSignal(signal);
      }

      // Generate evolution suggestions
      const suggestions = this.evolver.suggestFromAnalysis(analysis);
      if (suggestions.length > 0) {
        // Store suggestions for the mutate cycle to pick up
        const suggestionsPath = resolve(this.workspace, '.whetstone', 'pending-evolutions.json');
        const existing = existsSync(suggestionsPath)
          ? JSON.parse(readFileSync(suggestionsPath, 'utf8'))
          : [];
        existing.push(...suggestions);
        writeFileSync(suggestionsPath, JSON.stringify(existing, null, 2));
      }
    }

    return analysis;
  }

  /**
   * Analyse all pending traces.
   */
  async analysePending(): Promise<AnalysisResult[]> {
    const results = this.analyser.analysePending();

    for (const analysis of results) {
      for (const signal of analysis.signals) {
        await this.addSignal(signal);
      }
    }

    return results;
  }

  /**
   * Get tool reliability stats.
   */
  getToolStats(): ReturnType<ExecutionAnalyser['getToolStats']> {
    return this.analyser.getToolStats();
  }

  /**
   * Get degraded tools.
   */
  getDegradedTools(): ReturnType<ExecutionAnalyser['getDegradedTools']> {
    return this.analyser.getDegradedTools();
  }

  /**
   * Execute a skill evolution.
   */
  evolve(suggestion: EvolutionSuggestion, content: string, signalIds?: string[]): EvolutionRecord {
    return this.evolver.execute(suggestion, content, signalIds);
  }

  /**
   * Get evolution history.
   */
  getEvolutionHistory(limit?: number): EvolutionRecord[] {
    return this.evolver.getHistory(limit);
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
