/**
 * ML components for Whetstone.
 *
 * - Signal Classifier: Learned signal detection
 * - Joint Embeddings: Cluster signals by root cause
 * - Energy Function: Rank mutations by predicted effectiveness
 * - Cross-Agent Transfer: Share validated rules between agents
 */

export {
  SignalClassifier,
  getEmbedding,
  cosineSimilarity,
  generateSyntheticTrainingData,
  type ClassifierPrediction,
  type TrainingExample,
} from './classifier.js';

export {
  JointEmbeddingSpace,
  type EmbeddedSignal,
  type SignalCluster,
} from './embeddings.js';

export {
  EnergyFunction,
  generateSyntheticEnergyTrainingData,
  type MutationContext,
  type RankedMutation,
} from './energy.js';

export {
  CrossAgentStore,
  transferToMutation,
  type ValidatedRule,
  type TransferCandidate,
} from './transfer.js';
