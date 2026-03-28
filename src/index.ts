/**
 * Whetstone — Self-improving AI agents.
 *
 * Three loops that turn corrections into durable behaviour changes:
 * Sense → Mutate → Validate.
 *
 * ML components:
 * - Signal Classifier: Learned signal detection
 * - Joint Embeddings: Cluster signals by root cause
 * - Energy Function: Rank mutations by predicted effectiveness
 * - Cross-Agent Transfer: Share validated rules between agents
 */

// Main class
export { Whetstone, type WhetstoneState } from './whetstone.js';

// ML components
export {
  SignalClassifier,
  getEmbedding,
  cosineSimilarity,
  generateSyntheticTrainingData,
  JointEmbeddingSpace,
  EnergyFunction,
  generateSyntheticEnergyTrainingData,
  CrossAgentStore,
  transferToMutation,
} from './ml/index.js';

export type {
  ClassifierPrediction,
  TrainingExample,
  EmbeddedSignal,
  SignalCluster,
  MutationContext,
  RankedMutation,
  ValidatedRule,
  TransferCandidate,
} from './ml/index.js';

// Types
export type {
  Signal,
  SignalType,
  SignalCategory,
  Confidence,
  Mutation,
  MutationAction,
  MutableFile,
  RiskLevel,
  Validation,
  ValidationVerdict,
  WhetstoneConfig,
  ThoughtLayerEntry,
  ThoughtLayerQueryResult,
  ThoughtLayerClient,
  CapabilityReport,
  SafetyCheckResult,
  ImmutabilityCheckResult,
} from './types.js';

export { DEFAULT_CONFIG } from './types.js';

// Configuration
export {
  loadConfig,
  saveConfig,
  ensureDirectories,
  getWhetstoneDir,
  getConfigPath,
} from './config.js';

// Sense (signal detection)
export {
  detectSignalPatterns,
  analyseConversation,
  buildSignalTemplate,
} from './sense.js';
export type { ConversationTurn } from './sense.js';

// Mutate (behaviour changes)
export {
  applyMutation,
  applyMutationBatch,
  generateMutationId,
} from './mutate.js';
export type { ApplyResult } from './mutate.js';

// Validate (effectiveness measurement)
export {
  computeVerdict,
  buildValidation,
  validateBatch,
  getRollbackCandidates,
  getKeepers,
} from './validate.js';

// Recorder (execution tracing)
export { TraceRecorder } from './recorder.js';
export type {
  TraceEvent,
  StartEvent,
  ToolEvent,
  ErrorEvent,
  EndEvent,
  ToolStats as TraceToolStats,
  TraceSummary,
  TraceEventType,
  ToolStatus,
  TaskOutcome,
} from './recorder.js';

// Analyser (post-execution analysis)
export { ExecutionAnalyser } from './analyser.js';
export type {
  AnalysisResult,
  ToolDegradation,
  AggregateToolStats,
} from './analyser.js';

// Evolution (FIX / DERIVED / CAPTURED)
export { SkillEvolver } from './evolution.js';
export type {
  EvolutionType,
  EvolutionTrigger,
  EvolutionRecord,
  EvolutionSuggestion,
  SkillHealth,
} from './evolution.js';

// Safety
export {
  isLineImmutable,
  findImmutableLines,
  checkMutationSafety,
  snapshotFiles,
  rollbackFromSnapshot,
  validateMutationTarget,
} from './safety.js';
