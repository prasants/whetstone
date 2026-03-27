/**
 * Cross-Agent Transfer Learning.
 *
 * When one agent learns "always verify database results before presenting them,"
 * that learning transfers to every agent that queries databases.
 *
 * Mechanism: retrieve the K nearest validated rules from any agent,
 * weighted by semantic similarity, validation score, and domain overlap.
 */

import { getEmbedding, cosineSimilarity } from './classifier.js';
import { Mutation, Validation, MutableFile } from '../types.js';

export interface ValidatedRule {
  id: string;
  agentId: string;
  rule: string;
  embedding: number[];
  validation: Validation;
  toolsInvolved: string[];
  filesInvolved: string[];
  createdAt: string;
}

export interface TransferCandidate {
  rule: ValidatedRule;
  score: number;
  breakdown: {
    semanticSimilarity: number;
    validationScore: number;
    domainOverlap: number;
  };
}

/**
 * Cross-agent rule store.
 */
export class CrossAgentStore {
  private rules: ValidatedRule[] = [];

  constructor() {}

  /**
   * Add a validated rule from an agent.
   */
  async addRule(
    agentId: string,
    mutation: Mutation,
    validation: Validation,
    toolsInvolved: string[] = [],
    filesInvolved: string[] = [],
  ): Promise<ValidatedRule> {
    // Only store rules that were validated as effective
    if (validation.verdict !== 'keep') {
      throw new Error('Only validated (keep) rules can be transferred');
    }

    const embedding = await getEmbedding(mutation.content);

    const rule: ValidatedRule = {
      id: `${agentId}-${mutation.id}`,
      agentId,
      rule: mutation.content,
      embedding,
      validation,
      toolsInvolved,
      filesInvolved,
      createdAt: new Date().toISOString(),
    };

    this.rules.push(rule);
    return rule;
  }

  /**
   * Find transferable rules for a given context.
   */
  async findTransferCandidates(
    currentContext: string,
    currentTools: string[],
    currentFiles: string[],
    excludeAgentId?: string,
    topK: number = 5,
  ): Promise<TransferCandidate[]> {
    if (this.rules.length === 0) {
      return [];
    }

    const contextEmbedding = await getEmbedding(currentContext);

    const candidates: TransferCandidate[] = [];

    for (const rule of this.rules) {
      // Skip rules from the same agent if requested
      if (excludeAgentId && rule.agentId === excludeAgentId) {
        continue;
      }

      // Calculate semantic similarity
      const semanticSimilarity = cosineSimilarity(contextEmbedding, rule.embedding);

      // Calculate validation score (impact normalised to [0, 1])
      const validationScore = Math.min(rule.validation.impactScore / 5, 1);

      // Calculate domain overlap (tools + files in common)
      const toolOverlap = this.calculateOverlap(currentTools, rule.toolsInvolved);
      const fileOverlap = this.calculateOverlap(currentFiles, rule.filesInvolved);
      const domainOverlap = (toolOverlap + fileOverlap) / 2;

      // Weighted score
      const score =
        semanticSimilarity * 0.4 + validationScore * 0.4 + domainOverlap * 0.2;

      candidates.push({
        rule,
        score,
        breakdown: {
          semanticSimilarity,
          validationScore,
          domainOverlap,
        },
      });
    }

    // Sort by score (highest first)
    candidates.sort((a, b) => b.score - a.score);

    return candidates.slice(0, topK);
  }

  /**
   * Calculate overlap between two arrays (Jaccard similarity).
   */
  private calculateOverlap(a: string[], b: string[]): number {
    if (a.length === 0 && b.length === 0) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);

    return intersection.size / union.size;
  }

  /**
   * Get rules from a specific agent.
   */
  getRulesByAgent(agentId: string): ValidatedRule[] {
    return this.rules.filter((r) => r.agentId === agentId);
  }

  /**
   * Get all rules.
   */
  getAllRules(): ValidatedRule[] {
    return [...this.rules];
  }

  /**
   * Get statistics.
   */
  getStats(): {
    totalRules: number;
    rulesByAgent: Record<string, number>;
    avgImpactScore: number;
  } {
    const rulesByAgent: Record<string, number> = {};
    let totalImpact = 0;

    for (const rule of this.rules) {
      rulesByAgent[rule.agentId] = (rulesByAgent[rule.agentId] || 0) + 1;
      totalImpact += rule.validation.impactScore;
    }

    return {
      totalRules: this.rules.length,
      rulesByAgent,
      avgImpactScore: this.rules.length > 0 ? totalImpact / this.rules.length : 0,
    };
  }

  /**
   * Export state for persistence.
   */
  exportState(): ValidatedRule[] {
    return this.rules;
  }

  /**
   * Load state from persistence.
   */
  loadState(rules: ValidatedRule[]): void {
    this.rules = rules;
  }

  /**
   * Remove old rules (cleanup).
   */
  pruneOldRules(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const initialCount = this.rules.length;

    this.rules = this.rules.filter(
      (r) => new Date(r.createdAt).getTime() > cutoff,
    );

    return initialCount - this.rules.length;
  }
}

/**
 * Convert a transfer candidate to a mutation proposal.
 */
export function transferToMutation(
  candidate: TransferCandidate,
  targetFile: MutableFile,
  location: string,
): Mutation {
  return {
    id: `T-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    file: targetFile,
    action: 'add',
    location,
    content: candidate.rule.rule,
    risk: 'medium', // Transfer mutations always start at medium risk
    rationale: `Transferred from agent "${candidate.rule.agentId}" (score: ${candidate.score.toFixed(2)}, impact: ${candidate.rule.validation.impactScore})`,
    signalCount: candidate.rule.validation.signalsBefore,
    signalIds: [],
    expectedImpact: `Replicate ${candidate.rule.validation.impactScore} signal reduction from source agent`,
  };
}
