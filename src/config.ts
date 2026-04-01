/**
 * Configuration loading and validation.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { WhetstoneConfig, DEFAULT_CONFIG } from './types.js';

/**
 * Atomic write: writes to a temp file then renames (atomic on POSIX).
 * Prevents corruption if the process crashes mid-write.
 */
export function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  try {
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    throw err;
  }
}

const WHETSTONE_DIR = '.whetstone';
const CONFIG_FILE = 'config.json';

export function getWhetstoneDir(workspace: string): string {
  return resolve(workspace, WHETSTONE_DIR);
}

export function getConfigPath(workspace: string): string {
  return resolve(getWhetstoneDir(workspace), CONFIG_FILE);
}

/**
 * Validate that parsed config values have correct types.
 * Strips unknown keys and coerces to defaults where invalid.
 */
function validateConfig(parsed: Record<string, unknown>): Partial<WhetstoneConfig> {
  const valid: Partial<WhetstoneConfig> = {};

  if (typeof parsed.version === 'string') valid.version = parsed.version;
  if (parsed.senseModel === null || typeof parsed.senseModel === 'string') {
    valid.senseModel = parsed.senseModel as string | null;
  }
  if (['daily', 'weekly', 'biweekly'].includes(parsed.mutateSchedule as string)) {
    valid.mutateSchedule = parsed.mutateSchedule as WhetstoneConfig['mutateSchedule'];
  }
  if (['low', 'medium', 'high', 'critical'].includes(parsed.approvalThreshold as string)) {
    valid.approvalThreshold = parsed.approvalThreshold as WhetstoneConfig['approvalThreshold'];
  }
  if (typeof parsed.minSignalsForMutation === 'number' && parsed.minSignalsForMutation > 0) {
    valid.minSignalsForMutation = parsed.minSignalsForMutation;
  }
  if (typeof parsed.maxMutationsPerWeek === 'number' && parsed.maxMutationsPerWeek > 0) {
    valid.maxMutationsPerWeek = parsed.maxMutationsPerWeek;
  }
  if (Array.isArray(parsed.immutableMarkers) && parsed.immutableMarkers.every((m: unknown) => typeof m === 'string')) {
    valid.immutableMarkers = parsed.immutableMarkers as string[];
  }
  if (typeof parsed.thoughtlayerDomain === 'string') {
    valid.thoughtlayerDomain = parsed.thoughtlayerDomain;
  }
  if (Array.isArray(parsed.mutableFiles) && parsed.mutableFiles.every((f: unknown) => typeof f === 'string')) {
    valid.mutableFiles = parsed.mutableFiles as WhetstoneConfig['mutableFiles'];
  }
  // ThoughtLayer integration config (optional)
  if (parsed.thoughtlayer && typeof parsed.thoughtlayer === 'object') {
    const tl = parsed.thoughtlayer as Record<string, unknown>;
    valid.thoughtlayer = {
      enabled: tl.enabled === true,
      projectRoot: typeof tl.projectRoot === 'string' ? tl.projectRoot : undefined,
      domain: typeof tl.domain === 'string' ? tl.domain : undefined,
    };
  }

  return valid;
}

export function loadConfig(workspace: string): WhetstoneConfig {
  const configPath = getConfigPath(workspace);

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const validated = validateConfig(parsed);
    return { ...DEFAULT_CONFIG, ...validated };
  } catch (err) {
    console.warn(`[whetstone] Failed to load config from ${configPath}, using defaults:`, err);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(workspace: string, config: WhetstoneConfig): void {
  atomicWriteFileSync(
    getConfigPath(workspace),
    JSON.stringify(config, null, 2) + '\n',
  );
}

export function ensureDirectories(workspace: string): void {
  const dirs = [
    getWhetstoneDir(workspace),
    resolve(getWhetstoneDir(workspace), 'rollbacks'),
    resolve(getWhetstoneDir(workspace), 'reports'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}
