/**
 * Mutation engine.
 *
 * Applies proposed mutations to agent configuration files,
 * respecting safety constraints at every step.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  Mutation,
  WhetstoneConfig,
  SafetyCheckResult,
} from './types.js';
import { checkMutationSafety, snapshotFiles } from './safety.js';
import { atomicWriteFileSync } from './config.js';

export interface ApplyResult {
  mutationId: string;
  applied: boolean;
  reason?: string;
  safetyCheck: SafetyCheckResult;
}

/**
 * Apply a single mutation to the workspace.
 *
 * Returns whether the mutation was applied and why.
 * Never throws — failures are returned as results.
 */
export function applyMutation(
  mutation: Mutation,
  workspace: string,
  config: WhetstoneConfig,
): ApplyResult {
  // Run safety checks first
  const safetyCheck = checkMutationSafety(mutation, workspace, config);

  if (!safetyCheck.passed) {
    const reasons = [
      ...safetyCheck.immutableViolations.map(
        (v) => `Immutable line ${v.line}: "${v.content.substring(0, 60)}..."`,
      ),
      ...safetyCheck.conflicts,
      ...safetyCheck.redundancies,
    ];

    return {
      mutationId: mutation.id,
      applied: false,
      reason: reasons.join('; '),
      safetyCheck,
    };
  }

  const filePath = resolve(workspace, mutation.file);

  if (mutation.action === 'add') {
    return applyAddMutation(mutation, filePath, config);
  }

  if (mutation.action === 'modify') {
    return applyModifyMutation(mutation, filePath, config);
  }

  return {
    mutationId: mutation.id,
    applied: false,
    reason: `Unknown action: ${mutation.action}`,
    safetyCheck,
  };
}

function applyAddMutation(
  mutation: Mutation,
  filePath: string,
  config: WhetstoneConfig,
): ApplyResult {
  // Run safety checks even for add mutations (redundancy, immutability)
  const safetyCheck = existsSync(filePath)
    ? checkMutationSafety(mutation, filePath, config)
    : { passed: true, immutableViolations: [], conflicts: [], redundancies: [] };

  if (!safetyCheck.passed) {
    return { mutationId: mutation.id, applied: false, reason: 'Safety check failed', safetyCheck };
  }

  if (!existsSync(filePath)) {
    // Create file with content
    atomicWriteFileSync(filePath, mutation.content + '\n');
    return { mutationId: mutation.id, applied: true, safetyCheck };
  }

  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Find the anchor line (exact trimmed match to avoid partial substring hits)
  // Match anchor: strip leading list markers (- , * , digits.) then compare
  const normalise = (s: string) => s.trim().replace(/^[-*]\s+|^\d+\.\s+/, '');
  const target = normalise(mutation.location);
  const anchorIdx = lines.findIndex((l) => normalise(l) === target);

  if (anchorIdx === -1) {
    return {
      mutationId: mutation.id,
      applied: false,
      reason: `Anchor "${mutation.location}" not found in ${mutation.file}`,
      safetyCheck,
    };
  }

  // Insert after the anchor (split multi-line content)
  const newLines = mutation.content.split('\n');
  lines.splice(anchorIdx + 1, 0, ...newLines);
  atomicWriteFileSync(filePath, lines.join('\n'));

  return { mutationId: mutation.id, applied: true, safetyCheck };
}

function applyModifyMutation(
  mutation: Mutation,
  filePath: string,
  config: WhetstoneConfig,
): ApplyResult {
  const safetyCheck: SafetyCheckResult = {
    passed: true,
    immutableViolations: [],
    conflicts: [],
    redundancies: [],
  };

  if (!existsSync(filePath)) {
    return {
      mutationId: mutation.id,
      applied: false,
      reason: `File does not exist: ${mutation.file}`,
      safetyCheck,
    };
  }

  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const normalise = (s: string) => s.trim().replace(/^[-*]\s+|^\d+\.\s+/, '');
  const target = normalise(mutation.location);
  const targetIdx = lines.findIndex((l) => normalise(l) === target);

  if (targetIdx === -1) {
    return {
      mutationId: mutation.id,
      applied: false,
      reason: `Target "${mutation.location}" not found in ${mutation.file}`,
      safetyCheck,
    };
  }

  lines[targetIdx] = mutation.content;
  atomicWriteFileSync(filePath, lines.join('\n'));

  return { mutationId: mutation.id, applied: true, safetyCheck };
}

/**
 * Apply a batch of mutations with snapshot safety.
 *
 * Takes a snapshot before applying any mutations.
 * Returns results for each mutation.
 */
export function applyMutationBatch(
  mutations: Mutation[],
  workspace: string,
  config: WhetstoneConfig,
): { snapshotDir: string; results: ApplyResult[] } {
  // Snapshot before any mutations
  const snapshotDir = snapshotFiles(workspace, config);

  // Apply each mutation
  const results = mutations.map((m) =>
    applyMutation(m, workspace, config),
  );

  return { snapshotDir, results };
}

/**
 * Generate a mutation ID in the format M-YYYYMMDD-NNN.
 */
export function generateMutationId(index: number, date?: Date): string {
  const d = date || new Date();
  const dateStr = d.toISOString().split('T')[0].replace(/-/g, '');
  const num = String(index).padStart(3, '0');
  return `M-${dateStr}-${num}`;
}
