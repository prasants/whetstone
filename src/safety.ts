/**
 * Safety checks for mutations.
 *
 * This is the most important module in Whetstone. It enforces three
 * invariants:
 *
 * 1. Immutable lines are never modified.
 * 2. Rules are never removed (only added or modified with approval).
 * 3. Every mutation is reversible via snapshot.
 */

import { existsSync, readFileSync, copyFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import {
  WhetstoneConfig,
  Mutation,
  MutableFile,
  SafetyCheckResult,
  ImmutabilityCheckResult,
} from './types.js';

/**
 * Check whether a line contains an immutability marker.
 */
export function isLineImmutable(
  line: string,
  markers: string[],
): boolean {
  const upper = line.toUpperCase();
  return markers.some((m) => upper.includes(m.toUpperCase()));
}

/**
 * Scan a file for all immutable lines.
 */
export function findImmutableLines(
  filePath: string,
  markers: string[],
): ImmutabilityCheckResult[] {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const results: ImmutabilityCheckResult[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const marker of markers) {
      if (line.toUpperCase().includes(marker.toUpperCase())) {
        results.push({
          line: i + 1,
          content: line.substring(0, 200),
          marker,
          isImmutable: true,
        });
        break;
      }
    }
  }

  return results;
}

/**
 * Run all safety checks on a proposed mutation.
 */
export function checkMutationSafety(
  mutation: Mutation,
  workspace: string,
  config: WhetstoneConfig,
): SafetyCheckResult {
  const filePath = resolve(workspace, mutation.file);
  const result: SafetyCheckResult = {
    passed: true,
    immutableViolations: [],
    conflicts: [],
    redundancies: [],
  };

  // 1. File must be in the mutable list
  if (!config.mutableFiles.includes(mutation.file)) {
    result.passed = false;
    result.conflicts.push(
      `File "${mutation.file}" is not in the mutable files list`,
    );
    return result;
  }

  // 2. File must exist (for modify actions)
  if (mutation.action === 'modify' && !existsSync(filePath)) {
    result.passed = false;
    result.conflicts.push(`File "${mutation.file}" does not exist`);
    return result;
  }

  // 3. Check for immutable line violations
  if (mutation.action === 'modify' && existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Find the target line
    const targetIdx = lines.findIndex((l) =>
      l.includes(mutation.location),
    );

    if (targetIdx !== -1) {
      if (isLineImmutable(lines[targetIdx], config.immutableMarkers)) {
        result.passed = false;
        result.immutableViolations.push({
          line: targetIdx + 1,
          content: lines[targetIdx].substring(0, 200),
          marker: config.immutableMarkers.find((m) =>
            lines[targetIdx].toUpperCase().includes(m.toUpperCase()),
          ) || '',
          isImmutable: true,
        });
      }
    }
  }

  // 4. Check for redundancy (does the content already exist?)
  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf8');
    if (content.includes(mutation.content.trim())) {
      result.redundancies.push(
        `Content already exists in ${mutation.file}`,
      );
      result.passed = false;
    }
  }

  // 5. Removals are always blocked
  if (mutation.action !== 'add' && mutation.action !== 'modify') {
    result.passed = false;
    result.conflicts.push(
      `Action "${mutation.action}" is not permitted. Only "add" and "modify" are allowed.`,
    );
  }

  return result;
}

/**
 * Snapshot mutable files before applying mutations.
 * Returns the snapshot directory path.
 */
export function snapshotFiles(
  workspace: string,
  config: WhetstoneConfig,
  date?: string,
): string {
  const dateStr = date || new Date().toISOString().split('T')[0];
  const snapshotDir = resolve(
    workspace,
    '.whetstone',
    'rollbacks',
    dateStr,
  );

  if (!existsSync(snapshotDir)) {
    mkdirSync(snapshotDir, { recursive: true });
  }

  for (const file of config.mutableFiles) {
    const src = resolve(workspace, file);
    if (existsSync(src)) {
      copyFileSync(src, resolve(snapshotDir, file));
    }
  }

  return snapshotDir;
}

/**
 * Rollback files from a snapshot.
 */
export function rollbackFromSnapshot(
  workspace: string,
  snapshotDir: string,
  config: WhetstoneConfig,
): { restored: string[]; missing: string[] } {
  const restored: string[] = [];
  const missing: string[] = [];

  for (const file of config.mutableFiles) {
    const src = resolve(snapshotDir, file);
    const dst = resolve(workspace, file);

    if (existsSync(src)) {
      copyFileSync(src, dst);
      restored.push(file);
    } else {
      missing.push(file);
    }
  }

  return { restored, missing };
}

/**
 * Validate that a file is safe to mutate (exists, is a mutable file,
 * and the target location is not immutable).
 */
export function validateMutationTarget(
  workspace: string,
  file: MutableFile,
  location: string,
  config: WhetstoneConfig,
): { valid: boolean; reason?: string } {
  if (!config.mutableFiles.includes(file)) {
    return { valid: false, reason: `"${file}" is not a mutable file` };
  }

  const filePath = resolve(workspace, file);
  if (!existsSync(filePath)) {
    return { valid: false, reason: `"${file}" does not exist` };
  }

  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const targetIdx = lines.findIndex((l) => l.includes(location));

  if (targetIdx === -1) {
    return { valid: false, reason: `Anchor "${location}" not found in ${file}` };
  }

  if (isLineImmutable(lines[targetIdx], config.immutableMarkers)) {
    return {
      valid: false,
      reason: `Line ${targetIdx + 1} in ${file} is immutable`,
    };
  }

  return { valid: true };
}
