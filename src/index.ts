/**
 * Whetstone — Self-improving AI agents.
 *
 * Three loops that turn corrections into durable behaviour changes:
 * Sense → Mutate → Validate.
 */

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
  SignalCluster,
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

// Safety
export {
  isLineImmutable,
  findImmutableLines,
  checkMutationSafety,
  snapshotFiles,
  rollbackFromSnapshot,
  validateMutationTarget,
} from './safety.js';
