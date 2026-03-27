/**
 * Configuration loading and validation.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { WhetstoneConfig, DEFAULT_CONFIG } from './types.js';

const WHETSTONE_DIR = '.whetstone';
const CONFIG_FILE = 'config.json';

export function getWhetstoneDir(workspace: string): string {
  return resolve(workspace, WHETSTONE_DIR);
}

export function getConfigPath(workspace: string): string {
  return resolve(getWhetstoneDir(workspace), CONFIG_FILE);
}

export function loadConfig(workspace: string): WhetstoneConfig {
  const configPath = getConfigPath(workspace);

  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(workspace: string, config: WhetstoneConfig): void {
  const dir = getWhetstoneDir(workspace);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(
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
