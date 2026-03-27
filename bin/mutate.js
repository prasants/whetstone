#!/usr/bin/env node

/**
 * Mutate — Propose and apply behaviour mutations.
 *
 * Usage:
 *   whetstone-mutate              Show instructions
 *   whetstone-mutate --dry-run    Propose without applying
 *   whetstone-mutate --rollback YYYY-MM-DD   Rollback to snapshot
 */

import { existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || process.cwd();
const WHETSTONE_DIR = resolve(WORKSPACE, '.whetstone');
const ROLLBACK_DIR = resolve(WHETSTONE_DIR, 'rollbacks');

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
whetstone: mutate

Propose and apply behaviour mutations based on accumulated signals.

Usage:
  whetstone-mutate                      Show instructions
  whetstone-mutate --dry-run            Propose without applying
  whetstone-mutate --rollback DATE      Rollback to snapshot (YYYY-MM-DD)
  whetstone-mutate --list-snapshots     List available snapshots

Designed to run as a weekly cron in an isolated agent session.
The agent queries ThoughtLayer for recent signals, clusters them,
proposes mutations, and applies approved changes with rollback safety.
  `);
  process.exit(0);
}

if (args.includes('--list-snapshots')) {
  if (!existsSync(ROLLBACK_DIR)) {
    console.log('[mutate] No snapshots found.');
    process.exit(0);
  }

  const snapshots = readdirSync(ROLLBACK_DIR).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  if (snapshots.length === 0) {
    console.log('[mutate] No snapshots found.');
  } else {
    console.log('[mutate] Available snapshots:');
    snapshots.sort().reverse().forEach((s) => console.log(`  ${s}`));
  }
  process.exit(0);
}

if (args.includes('--rollback')) {
  const dateIdx = args.indexOf('--rollback') + 1;
  const date = args[dateIdx];

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('[mutate] Invalid date format. Use YYYY-MM-DD.');
    process.exit(1);
  }

  const snapshotDir = resolve(ROLLBACK_DIR, date);
  if (!existsSync(snapshotDir)) {
    console.error(`[mutate] No snapshot found for ${date}`);
    process.exit(1);
  }

  console.log(`[mutate] Rolling back to ${date}...`);
  // Import and call the rollback function
  import('../dist/safety.js').then(({ rollbackFromSnapshot, DEFAULT_CONFIG }) => {
    import('../dist/types.js').then(({ DEFAULT_CONFIG: cfg }) => {
      const result = rollbackFromSnapshot(WORKSPACE, snapshotDir, cfg);
      console.log(`[mutate] Restored: ${result.restored.join(', ')}`);
      if (result.missing.length > 0) {
        console.log(`[mutate] Missing from snapshot: ${result.missing.join(', ')}`);
      }
    });
  }).catch(() => {
    console.error('[mutate] Run `npm run build` first.');
    process.exit(1);
  });
} else if (args.includes('--dry-run')) {
  console.log('[mutate] DRY RUN');
  console.log('[mutate] Would query ThoughtLayer for signals, cluster, and propose mutations.');
  console.log('[mutate] No changes will be applied.');
} else {
  console.log('[mutate] Ready.');
  console.log('[mutate] Run in an isolated agent session for the full mutation cycle.');
  console.log('[mutate] The agent will:');
  console.log('  1. Query ThoughtLayer for recent signals (domain: whetstone)');
  console.log('  2. Cluster signals by root cause');
  console.log('  3. Propose mutations using the mutation prompt');
  console.log('  4. Snapshot current files');
  console.log('  5. Apply approved mutations');
  console.log('  6. Store mutations in ThoughtLayer for validation');
}
