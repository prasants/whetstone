#!/usr/bin/env node

/**
 * Sense — Extract improvement signals from a session transcript.
 *
 * Usage:
 *   whetstone-sense                 Show instructions
 *   whetstone-sense --stdin         Read transcript from stdin
 *   whetstone-sense --dry-run       Show detections without storing
 */

import { readFileSync } from 'fs';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
whetstone: sense

Extract improvement signals from a session transcript.

Usage:
  whetstone-sense                 Show instructions
  whetstone-sense --stdin         Read transcript from stdin
  whetstone-sense --dry-run       Show detections without storing

In agent sessions, the sense prompt is injected via the heartbeat hook.
Signals are stored in ThoughtLayer (domain: whetstone).
  `);
  process.exit(0);
}

if (args.includes('--stdin')) {
  const transcript = readFileSync('/dev/stdin', 'utf8');

  if (args.includes('--dry-run')) {
    console.log('[sense] DRY RUN');
    console.log(`[sense] Transcript: ${transcript.length} chars`);
    console.log('[sense] Would extract signals and store in ThoughtLayer.');
  } else {
    // In production, this outputs the transcript for the agent to process
    // with the sense prompt. The actual extraction happens in the LLM.
    console.log(transcript.substring(0, 50000));
  }
} else {
  console.log('[sense] Ready.');
  console.log('[sense] Use --stdin to pipe a transcript for signal extraction.');
  console.log('[sense] In agent sessions, sensing runs automatically via the heartbeat hook.');
}
