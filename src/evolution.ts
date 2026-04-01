/**
 * SkillEvolver — Evolve agent skills based on execution evidence.
 *
 * Three evolution types (from OpenSpace):
 *   FIX      — repair broken skill in place (same file, patched)
 *   DERIVED  — create enhanced version from existing skill
 *   CAPTURED — capture novel reusable pattern from execution
 *
 * Three trigger sources:
 *   1. Post-analysis   — analyser found failures or degradation
 *   2. Tool degradation — a tool's reliability dropped below threshold
 *   3. Signal clustering — mutate cycle found clustered signals
 *
 * All evolutions are tracked with lineage (parent→child) and can be
 * rolled back if validation fails.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { Signal } from './types.js';
import { ToolDegradation, AnalysisResult } from './analyser.js';

// ── Types ───────────────────────────────────────────────────────

export type EvolutionType = 'fix' | 'derived' | 'captured';
export type EvolutionTrigger = 'analysis' | 'tool_degradation' | 'signal_cluster';

export interface EvolutionRecord {
  id: string;
  type: EvolutionType;
  trigger: EvolutionTrigger;
  targetSkill: string;        // skill directory name
  parentSkill?: string;       // for DERIVED: original skill
  description: string;
  changeSummary: string;
  signals: string[];          // signal IDs that triggered this
  createdAt: string;
  validated?: boolean;
  rolledBack?: boolean;
  snapshot?: string;          // path to pre-evolution backup
}

export interface EvolutionSuggestion {
  type: EvolutionType;
  trigger: EvolutionTrigger;
  targetSkill: string;
  direction: string;          // what needs to change
  evidence: string;           // why (signals, degradation data)
  priority: number;           // 0-1, higher = more urgent
}

export interface SkillHealth {
  skillName: string;
  skillDir: string;
  totalExecutions: number;
  successRate: number;
  degradedTools: string[];
  lastEvolution?: string;
  needsAttention: boolean;
}

// ── Constants ───────────────────────────────────────────────────

const SKILL_FILE = 'SKILL.md';
const MAX_EVOLUTIONS_PER_CYCLE = 5;

// ── Evolver ─────────────────────────────────────────────────────

export class SkillEvolver {
  private workspace: string;
  private skillsDir: string;
  private evolutionDir: string;
  private records: EvolutionRecord[] = [];

  constructor(workspace: string, skillsDir?: string) {
    this.workspace = workspace;
    this.skillsDir = skillsDir || resolve(workspace, 'skills');
    this.evolutionDir = resolve(workspace, '.whetstone', 'evolutions');
    mkdirSync(this.evolutionDir, { recursive: true });
    this.loadRecords();
  }

  /**
   * Generate evolution suggestions from analysis results.
   */
  suggestFromAnalysis(analysis: AnalysisResult): EvolutionSuggestion[] {
    const suggestions: EvolutionSuggestion[] = [];

    // Tool degradations → FIX suggestions for skills that use those tools
    for (const degradation of analysis.toolDegradations) {
      const affectedSkills = this.findSkillsUsingTool(degradation.tool);

      for (const skill of affectedSkills) {
        suggestions.push({
          type: 'fix',
          trigger: 'tool_degradation',
          targetSkill: skill,
          direction: `Tool ${degradation.tool} is degraded (${Math.round(degradation.successRate * 100)}% success). Update skill to handle failures or use fallback.`,
          evidence: `${degradation.errors}/${degradation.totalCalls} calls failed. Last error: ${degradation.lastError}`,
          priority: degradation.severity === 'critical' ? 0.9 : 0.6,
        });
      }
    }

    // Task failures → CAPTURED suggestion if a novel pattern emerged
    if (analysis.signals.some((s) => s.type === 'failure')) {
      const failureSignals = analysis.signals.filter((s) => s.type === 'failure');

      // Check if this failure pattern already has a skill
      for (const signal of failureSignals) {
        const existingSkill = this.findSkillForPattern(signal.rootCause);
        if (!existingSkill) {
          suggestions.push({
            type: 'captured',
            trigger: 'analysis',
            targetSkill: this.generateSkillName(signal.what),
            direction: `Capture a skill to handle: ${signal.what}`,
            evidence: `Root cause: ${signal.rootCause}. Suggested rule: ${signal.suggestedRule}`,
            priority: signal.confidence === 'high' ? 0.7 : 0.4,
          });
        }
      }
    }

    return suggestions.slice(0, MAX_EVOLUTIONS_PER_CYCLE);
  }

  /**
   * Generate suggestions from clustered signals (called by mutate cycle).
   */
  suggestFromClusters(
    clusters: Array<{ rootCause: string; signals: Signal[]; count: number }>,
  ): EvolutionSuggestion[] {
    const suggestions: EvolutionSuggestion[] = [];

    for (const cluster of clusters) {
      // Find if an existing skill covers this area
      const existingSkill = this.findSkillForPattern(cluster.rootCause);

      if (existingSkill) {
        // DERIVED: improve existing skill based on new evidence
        suggestions.push({
          type: 'derived',
          trigger: 'signal_cluster',
          targetSkill: existingSkill,
          direction: `${cluster.count} signals suggest improving: ${cluster.rootCause}`,
          evidence: cluster.signals
            .map((s) => s.what)
            .slice(0, 3)
            .join('; '),
          priority: Math.min(cluster.count / 10, 0.9),
        });
      } else {
        // CAPTURED: new skill from clustered pattern
        suggestions.push({
          type: 'captured',
          trigger: 'signal_cluster',
          targetSkill: this.generateSkillName(cluster.rootCause),
          direction: `Capture skill for pattern: ${cluster.rootCause}`,
          evidence: `${cluster.count} signals. Examples: ${cluster.signals.map((s) => s.what).slice(0, 3).join('; ')}`,
          priority: Math.min(cluster.count / 10, 0.8),
        });
      }
    }

    return suggestions
      .sort((a, b) => b.priority - a.priority)
      .slice(0, MAX_EVOLUTIONS_PER_CYCLE);
  }

  /**
   * Execute an evolution (FIX, DERIVED, or CAPTURED).
   *
   * Returns the evolution record. The actual content changes must be
   * provided by the caller (typically an LLM agent) via `content`.
   */
  execute(
    suggestion: EvolutionSuggestion,
    content: string,
    signalIds: string[] = [],
  ): EvolutionRecord {
    const id = `E-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const now = new Date().toISOString();

    let record: EvolutionRecord;

    switch (suggestion.type) {
      case 'fix':
        record = this.executeFix(id, suggestion, content, signalIds, now);
        break;
      case 'derived':
        record = this.executeDerived(id, suggestion, content, signalIds, now);
        break;
      case 'captured':
        record = this.executeCaptured(id, suggestion, content, signalIds, now);
        break;
      default:
        throw new Error(`Unknown evolution type: ${suggestion.type}`);
    }

    this.records.push(record);
    this.saveRecords();

    return record;
  }

  /**
   * Rollback an evolution.
   */
  rollback(evolutionId: string): boolean {
    const record = this.records.find((r) => r.id === evolutionId);
    if (!record || !record.snapshot) return false;

    const snapshotPath = record.snapshot;
    const skillDir = resolve(this.skillsDir, record.targetSkill);
    const skillFile = resolve(skillDir, SKILL_FILE);
    const snapshotFile = resolve(snapshotPath, SKILL_FILE);

    if (existsSync(snapshotFile) && existsSync(skillDir)) {
      copyFileSync(snapshotFile, skillFile);
      record.rolledBack = true;
      this.saveRecords();
      return true;
    }

    return false;
  }

  /**
   * Get evolution history.
   */
  getHistory(limit: number = 20): EvolutionRecord[] {
    return this.records
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, limit);
  }

  /**
   * Get skill health overview.
   */
  getSkillHealth(): SkillHealth[] {
    if (!existsSync(this.skillsDir)) return [];

    return readdirSync(this.skillsDir)
      .filter((d) =>
        existsSync(resolve(this.skillsDir, d, SKILL_FILE)),
      )
      .map((d) => {
        const evolutions = this.records.filter(
          (r) => r.targetSkill === d && !r.rolledBack,
        );
        const lastEvo = evolutions[evolutions.length - 1];

        return {
          skillName: d,
          skillDir: resolve(this.skillsDir, d),
          totalExecutions: evolutions.length,
          successRate: 1, // TODO: track per-skill success rate
          degradedTools: [],
          lastEvolution: lastEvo?.createdAt,
          needsAttention: false,
        };
      });
  }

  // ── Private: Evolution Executors ──────────────────────────────

  private executeFix(
    id: string,
    suggestion: EvolutionSuggestion,
    content: string,
    signalIds: string[],
    now: string,
  ): EvolutionRecord {
    const skillDir = resolve(this.skillsDir, suggestion.targetSkill);
    const skillFile = resolve(skillDir, SKILL_FILE);

    // Snapshot before fix
    const snapshotDir = resolve(this.evolutionDir, id);
    mkdirSync(snapshotDir, { recursive: true });
    if (existsSync(skillFile)) {
      copyFileSync(skillFile, resolve(snapshotDir, SKILL_FILE));
    }

    // Apply fix (overwrite SKILL.md) — skill must exist for a fix
    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true });
    }
    writeFileSync(skillFile, content);

    return {
      id,
      type: 'fix',
      trigger: suggestion.trigger,
      targetSkill: suggestion.targetSkill,
      description: suggestion.direction,
      changeSummary: `Fixed ${suggestion.targetSkill}: ${suggestion.direction.substring(0, 100)}`,
      signals: signalIds,
      createdAt: now,
      snapshot: snapshotDir,
    };
  }

  private executeDerived(
    id: string,
    suggestion: EvolutionSuggestion,
    content: string,
    signalIds: string[],
    now: string,
  ): EvolutionRecord {
    // Create new skill directory with version suffix
    const version = this.getNextVersion(suggestion.targetSkill);
    const newSkillName = `${suggestion.targetSkill}-v${version}`;
    const newSkillDir = resolve(this.skillsDir, newSkillName);

    mkdirSync(newSkillDir, { recursive: true });
    writeFileSync(resolve(newSkillDir, SKILL_FILE), content);

    return {
      id,
      type: 'derived',
      trigger: suggestion.trigger,
      targetSkill: newSkillName,
      parentSkill: suggestion.targetSkill,
      description: suggestion.direction,
      changeSummary: `Derived ${newSkillName} from ${suggestion.targetSkill}`,
      signals: signalIds,
      createdAt: now,
    };
  }

  private executeCaptured(
    id: string,
    suggestion: EvolutionSuggestion,
    content: string,
    signalIds: string[],
    now: string,
  ): EvolutionRecord {
    const skillDir = resolve(this.skillsDir, suggestion.targetSkill);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(resolve(skillDir, SKILL_FILE), content);

    return {
      id,
      type: 'captured',
      trigger: suggestion.trigger,
      targetSkill: suggestion.targetSkill,
      description: suggestion.direction,
      changeSummary: `Captured new skill: ${suggestion.targetSkill}`,
      signals: signalIds,
      createdAt: now,
    };
  }

  // ── Private: Helpers ──────────────────────────────────────────

  private findSkillsUsingTool(tool: string): string[] {
    if (!existsSync(this.skillsDir)) return [];

    return readdirSync(this.skillsDir)
      .filter((d) => {
        const skillFile = resolve(this.skillsDir, d, SKILL_FILE);
        if (!existsSync(skillFile)) return false;
        const content = readFileSync(skillFile, 'utf8').toLowerCase();
        return content.includes(tool.toLowerCase());
      });
  }

  private findSkillForPattern(pattern: string): string | null {
    if (!existsSync(this.skillsDir)) return null;

    const keywords = pattern
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5);
    if (keywords.length === 0) return null;

    for (const dir of readdirSync(this.skillsDir)) {
      const skillFile = resolve(this.skillsDir, dir, SKILL_FILE);
      if (!existsSync(skillFile)) continue;
      const content = readFileSync(skillFile, 'utf8').toLowerCase();
      const matches = keywords.filter((k) => content.includes(k)).length;
      if (matches >= Math.ceil(keywords.length * 0.6)) {
        return dir;
      }
    }

    return null;
  }

  private generateSkillName(description: string): string {
    return description
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join('-')
      .substring(0, 50);
  }

  private getNextVersion(skillName: string): number {
    const existing = readdirSync(this.skillsDir)
      .filter((d) => d.startsWith(`${skillName}-v`))
      .map((d) => {
        const match = d.match(/-v(\d+)$/);
        return match ? parseInt(match[1]) : 0;
      });

    return existing.length > 0 ? Math.max(...existing) + 1 : 2;
  }

  private loadRecords(): void {
    const recordsPath = resolve(this.evolutionDir, 'records.json');
    if (existsSync(recordsPath)) {
      try {
        this.records = JSON.parse(readFileSync(recordsPath, 'utf8'));
      } catch {
        this.records = [];
      }
    }
  }

  private saveRecords(): void {
    const recordsPath = resolve(this.evolutionDir, 'records.json');
    writeFileSync(recordsPath, JSON.stringify(this.records, null, 2));
  }
}
