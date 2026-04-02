/**
 * Core type definitions for Whetstone.
 *
 * Every data structure that crosses a boundary — between loops,
 * between Whetstone and ThoughtLayer, between code and config —
 * is defined here.
 */

// ── Signal Types ────────────────────────────────────────────────

export type SignalType =
  | 'correction'
  | 'failure'
  | 'takeover'
  | 'frustration'
  | 'style'
  | 'voice_correction'
  | 'success';

export type SignalCategory =
  | 'tool_use'
  | 'knowledge'
  | 'style'
  | 'judgment'
  | 'speed'
  | 'memory';

export type Confidence = 'high' | 'medium' | 'low';

export interface Signal {
  type: SignalType;
  what: string;
  rootCause: string;
  suggestedRule: string;
  confidence: Confidence;
  category: SignalCategory;
  context: string;
  sessionDate: string;
  toolsInvolved: string[];
  filesInvolved: string[];
}

// ── Mutation Types ──────────────────────────────────────────────

export type MutationAction = 'add' | 'modify' | 'store';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type MutableFile =
  | 'SOUL.md'
  | 'TOOLS.md'
  | 'AGENTS.md'
  | 'HEARTBEAT.md';

export interface Mutation {
  id: string;
  file: MutableFile;
  action: MutationAction;
  location: string;
  content: string;
  risk: RiskLevel;
  rationale: string;
  signalCount: number;
  signalIds: string[];
  expectedImpact: string;
  appliedAt?: string;
  /** ThoughtLayer entry ID — set after a successful store mutation. */
  entryId?: string;
}

// ── Validation Types ────────────────────────────────────────────

export type ValidationVerdict = 'keep' | 'rollback' | 'extend';

export interface Validation {
  mutationId: string;
  signalsBefore: number;
  signalsAfter: number;
  verdict: ValidationVerdict;
  reason: string;
  impactScore: number;
  validatedAt: string;
}

// ── Cluster Types ───────────────────────────────────────────────

export interface SignalCluster {
  rootCause: string;
  signals: Signal[];
  count: number;
  categories: SignalCategory[];
  hasExplicitCorrection: boolean;
}

// ── Configuration ───────────────────────────────────────────────

export interface ThoughtLayerConfig {
  /** Enable ThoughtLayer integration. Default: false. */
  enabled: boolean;
  /** Root path for ThoughtLayer database. Default: workspace path. */
  projectRoot?: string;
  /** Domain namespace for Whetstone entries. Default: "whetstone". */
  domain?: string;
}

export interface WhetstoneConfig {
  version: string;
  senseModel: string | null;
  mutateSchedule: 'daily' | 'weekly' | 'biweekly';
  approvalThreshold: RiskLevel;
  minSignalsForMutation: number;
  maxMutationsPerWeek: number;
  immutableMarkers: string[];
  thoughtlayerDomain: string;
  mutableFiles: MutableFile[];
  /** Optional ThoughtLayer integration. Install `thoughtlayer` package to enable. */
  thoughtlayer?: ThoughtLayerConfig;
}

export const DEFAULT_CONFIG: WhetstoneConfig = {
  version: '1.0.0',
  senseModel: null,
  mutateSchedule: 'weekly',
  approvalThreshold: 'medium',
  minSignalsForMutation: 3,
  maxMutationsPerWeek: 5,
  immutableMarkers: ['NON-NEGOTIABLE', 'MANDATORY', 'NEVER'],
  thoughtlayerDomain: 'whetstone',
  mutableFiles: ['SOUL.md', 'TOOLS.md', 'AGENTS.md', 'HEARTBEAT.md'],
};

// ── ThoughtLayer Integration ────────────────────────────────────

export interface ThoughtLayerEntry {
  id?: string;
  domain: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ThoughtLayerQueryResult {
  id: string;
  title: string;
  content: string;
  score: number;
  domain: string;
}

export interface ThoughtLayerClient {
  add(entry: ThoughtLayerEntry): Promise<{ id: string }>;
  query(query: string, topK?: number): Promise<ThoughtLayerQueryResult[]>;
  list(domain?: string): Promise<ThoughtLayerEntry[]>;
}

// ── Report Types ────────────────────────────────────────────────

export interface CapabilityReport {
  month: string;
  totalSignals: number;
  signalsByType: Record<SignalType, number>;
  signalsByCategory: Record<SignalCategory, number>;
  mutationsApplied: number;
  mutationsKept: number;
  mutationsRolledBack: number;
  capabilityScore: number;
  topWeakSpots: string[];
  recommendations: string[];
  trend: 'improving' | 'stable' | 'declining';
}

// ── Safety Types ────────────────────────────────────────────────

export interface ImmutabilityCheckResult {
  line: number;
  content: string;
  marker: string;
  isImmutable: boolean;
}

export interface SafetyCheckResult {
  passed: boolean;
  immutableViolations: ImmutabilityCheckResult[];
  conflicts: string[];
  redundancies: string[];
}
