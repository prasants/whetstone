/**
 * Joint Embedding Space — Cluster signals by root cause.
 *
 * Implements a JEPA-inspired joint embedding where signals,
 * contexts, and rules live in the same representation space.
 * Signals with the same root cause cluster together.
 */

import { getEmbedding, cosineSimilarity } from './classifier.js';
import { Signal, Mutation } from '../types.js';

export interface EmbeddedSignal {
  id: string;
  signal: Signal;
  embedding: number[];
}

export interface SignalCluster {
  id: string;
  rootCause: string;
  signals: EmbeddedSignal[];
  centroid: number[];
}

/**
 * Joint Embedding Space for signals, rules, and mutations.
 */
export class JointEmbeddingSpace {
  private signals: EmbeddedSignal[] = [];
  private clusters: SignalCluster[] = [];
  private clusterThreshold = 0.7; // Cosine similarity threshold for same cluster

  constructor() {}

  /**
   * Add a signal to the embedding space.
   */
  async addSignal(id: string, signal: Signal): Promise<EmbeddedSignal> {
    // Embed the signal's key fields together
    const textToEmbed = [
      signal.what,
      signal.rootCause,
      signal.context,
    ].join(' | ');

    const embedding = await getEmbedding(textToEmbed);
    const embedded: EmbeddedSignal = { id, signal, embedding };

    this.signals.push(embedded);
    await this.updateClusters(embedded);

    return embedded;
  }

  /**
   * Update clusters when a new signal is added.
   */
  private async updateClusters(newSignal: EmbeddedSignal): Promise<void> {
    // Find the closest existing cluster
    let bestCluster: SignalCluster | null = null;
    let bestSimilarity = -Infinity;

    for (const cluster of this.clusters) {
      const similarity = cosineSimilarity(newSignal.embedding, cluster.centroid);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestCluster = cluster;
      }
    }

    if (bestCluster && bestSimilarity >= this.clusterThreshold) {
      // Add to existing cluster
      bestCluster.signals.push(newSignal);
      // Update centroid (incremental mean)
      const n = bestCluster.signals.length;
      for (let i = 0; i < bestCluster.centroid.length; i++) {
        bestCluster.centroid[i] =
          ((n - 1) * bestCluster.centroid[i] + newSignal.embedding[i]) / n;
      }
    } else {
      // Create new cluster
      const newCluster: SignalCluster = {
        id: `cluster-${this.clusters.length + 1}`,
        rootCause: newSignal.signal.rootCause,
        signals: [newSignal],
        centroid: [...newSignal.embedding],
      };
      this.clusters.push(newCluster);
    }
  }

  /**
   * Find clusters with enough signals for mutation.
   */
  getMutationCandidates(minSignals: number = 3): SignalCluster[] {
    return this.clusters.filter((c) => c.signals.length >= minSignals);
  }

  /**
   * Find the N most similar signals to a query.
   */
  async findSimilar(query: string, topK: number = 5): Promise<EmbeddedSignal[]> {
    const queryEmbedding = await getEmbedding(query);

    const scored = this.signals.map((s) => ({
      signal: s,
      score: cosineSimilarity(queryEmbedding, s.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.signal);
  }

  /**
   * Check if a proposed rule is similar to existing signals.
   * Used to detect overfitting (rule too specific to one signal).
   */
  async checkOverfitting(
    rule: string,
    triggeringSignals: string[],
  ): Promise<{ isOverfit: boolean; reason: string }> {
    const ruleEmbedding = await getEmbedding(rule);

    // Get embeddings of triggering signals
    const triggeringEmbeddings = this.signals.filter((s) =>
      triggeringSignals.includes(s.id),
    );

    if (triggeringEmbeddings.length === 0) {
      return { isOverfit: false, reason: 'No triggering signals found' };
    }

    // Check if the rule is too similar to just one signal
    const similarities = triggeringEmbeddings.map((s) =>
      cosineSimilarity(ruleEmbedding, s.embedding),
    );

    const maxSim = Math.max(...similarities);
    const avgSim = similarities.reduce((a, b) => a + b, 0) / similarities.length;

    // If one signal dominates (much more similar than average), it's overfit
    if (maxSim > 0.9 && maxSim - avgSim > 0.2) {
      return {
        isOverfit: true,
        reason: `Rule is 90%+ similar to one specific signal (${maxSim.toFixed(2)} vs avg ${avgSim.toFixed(2)})`,
      };
    }

    return { isOverfit: false, reason: 'Rule generalises across signals' };
  }

  /**
   * Export state for persistence.
   */
  exportState(): {
    signals: Array<{ id: string; signal: Signal; embedding: number[] }>;
    clusters: Array<{
      id: string;
      rootCause: string;
      signalIds: string[];
      centroid: number[];
    }>;
  } {
    return {
      signals: this.signals,
      clusters: this.clusters.map((c) => ({
        id: c.id,
        rootCause: c.rootCause,
        signalIds: c.signals.map((s) => s.id),
        centroid: c.centroid,
      })),
    };
  }

  /**
   * Load state from persistence.
   */
  loadState(state: ReturnType<typeof this.exportState>): void {
    this.signals = state.signals;
    this.clusters = state.clusters.map((c) => ({
      id: c.id,
      rootCause: c.rootCause,
      signals: c.signalIds
        .map((id) => this.signals.find((s) => s.id === id))
        .filter((s): s is EmbeddedSignal => s !== undefined),
      centroid: c.centroid,
    }));
  }

  /**
   * Get cluster statistics.
   */
  getStats(): {
    totalSignals: number;
    totalClusters: number;
    avgClusterSize: number;
    largestCluster: number;
  } {
    const sizes = this.clusters.map((c) => c.signals.length);
    return {
      totalSignals: this.signals.length,
      totalClusters: this.clusters.length,
      avgClusterSize:
        sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0,
      largestCluster: sizes.length > 0 ? Math.max(...sizes) : 0,
    };
  }
}
