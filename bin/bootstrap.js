#!/usr/bin/env node

/**
 * Bootstrap — One-time setup for Whetstone.
 *
 * Creates the .whetstone/ directory, scans existing config files
 * for rules, and outputs setup instructions.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || process.cwd();
const WHETSTONE_DIR = resolve(WORKSPACE, '.whetstone');

function bootstrap() {
  console.log('[whetstone] Bootstrapping...');
  console.log(`[whetstone] Workspace: ${WORKSPACE}`);

  // 1. Create directory structure
  const dirs = [
    WHETSTONE_DIR,
    resolve(WHETSTONE_DIR, 'rollbacks'),
    resolve(WHETSTONE_DIR, 'reports'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`  ✓ Created ${dir.replace(WORKSPACE, '.')}`);
    }
  }

  // 2. Write default config
  const configPath = resolve(WHETSTONE_DIR, 'config.json');
  if (!existsSync(configPath)) {
    const config = {
      version: '1.0.0',
      senseModel: null,
      mutateSchedule: 'weekly',
      approvalThreshold: 'medium',
      minSignalsForMutation: 3,
      maxMutationsPerWeek: 5,
      immutableMarkers: ['NON-NEGOTIABLE', 'MANDATORY', 'NEVER'],
      thoughtlayerDomain: 'whetstone',
      created: new Date().toISOString(),
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log('  ✓ Created config.json');
  } else {
    console.log('  · config.json already exists');
  }

  // 3. Scan existing files for rules
  const filesToScan = ['SOUL.md', 'TOOLS.md', 'AGENTS.md', 'HEARTBEAT.md'];
  const ruleMarkers = [
    'NEVER', 'ALWAYS', 'MUST', 'NON-NEGOTIABLE', 'MANDATORY',
    'DO NOT', 'IMPORTANT', '🔴', 'REQUIRED', 'CRITICAL',
  ];

  let immutable = 0;
  let modifiable = 0;

  for (const file of filesToScan) {
    const filePath = resolve(WORKSPACE, file);
    if (!existsSync(filePath)) continue;

    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 20) continue;

      if (ruleMarkers.some((m) => trimmed.toUpperCase().includes(m))) {
        if (['NON-NEGOTIABLE', 'MANDATORY', 'NEVER'].some((m) => trimmed.includes(m))) {
          immutable++;
        } else {
          modifiable++;
        }
      }
    }
  }

  console.log(`\n  Found ${immutable + modifiable} existing rules:`);
  console.log(`    ${immutable} immutable (will never be modified)`);
  console.log(`    ${modifiable} modifiable (can be refined by Whetstone)`);

  // 4. Output heartbeat hook
  console.log(`
┌─────────────────────────────────────────────┐
│  Add this to your HEARTBEAT.md:             │
└─────────────────────────────────────────────┘

## Whetstone — Sense Check

At each heartbeat, if the session has >5 exchanges and
signals haven't been extracted today:

1. Scan for improvement signals (corrections, failures,
   takeovers, frustration, style changes, successes)
2. Store each signal in ThoughtLayer (domain: "whetstone")
3. Log "whetstone: N signals extracted" to daily notes

┌─────────────────────────────────────────────┐
│  Set up two crons:                          │
└─────────────────────────────────────────────┘

1. Weekly mutation cycle (Sunday 2 AM):
   Schedule: "0 2 * * 0"
   Session: isolated
   Payload: agentTurn with mutate prompt

2. Monthly capability report (1st of month, 3 AM):
   Schedule: "0 3 1 * *"
   Session: isolated
   Payload: agentTurn with report prompt
`);

  console.log('[whetstone] Bootstrap complete. Sensing starts on next heartbeat.');
}

// Parse args
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
whetstone: bootstrap

One-time setup for Whetstone.

Usage:
  whetstone-bootstrap           Initialise .whetstone/ and scan rules
  whetstone-bootstrap --help    Show this help
  `);
  process.exit(0);
}

bootstrap();
