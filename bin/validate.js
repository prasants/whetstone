#!/usr/bin/env node

/**
 * Validate — Measure mutation effectiveness and rollback failures.
 *
 * Usage:
 *   whetstone-validate              Show instructions
 *   whetstone-validate --dry-run    Show verdicts without applying rollbacks
 */

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
whetstone: validate

Measure mutation effectiveness and rollback failures.

Usage:
  whetstone-validate              Show instructions
  whetstone-validate --dry-run    Show verdicts without applying rollbacks

For each active mutation:
  - Queries ThoughtLayer for signals before and after the mutation
  - Compares frequency of the target signal type
  - Keeps effective mutations, rolls back ineffective ones

Runs as part of the weekly mutate cycle.
  `);
  process.exit(0);
}

if (args.includes('--dry-run')) {
  console.log('[validate] DRY RUN');
  console.log('[validate] Would query mutations and compare signal counts.');
  console.log('[validate] No rollbacks will be applied.');
} else {
  console.log('[validate] Ready.');
  console.log('[validate] Run in an agent session for the full validation cycle.');
  console.log('[validate] The agent will:');
  console.log('  1. Query ThoughtLayer for mutations from 7-14 days ago');
  console.log('  2. For each mutation, compare signal counts before/after');
  console.log('  3. Keep effective mutations, rollback ineffective ones');
  console.log('  4. Store validation results in ThoughtLayer');
}
