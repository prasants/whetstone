#!/usr/bin/env node

/**
 * auto-sense — Fully automated Whetstone pipeline.
 *
 * Reads the main session transcript, runs ML classification on user messages,
 * adds signals to the embedding space, checks for mutation candidates,
 * ranks with the energy function, and applies safe mutations automatically.
 *
 * Designed to run via cron every 15 minutes with no manual intervention.
 *
 * Usage:
 *   node bin/auto-sense.js [--workspace /path] [--ollama-url http://host:11434]
 *   node bin/auto-sense.js --dry-run
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, appendFileSync, mkdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// Parse workspace
let workspace = process.env.OPENCLAW_WORKSPACE || '/home/openclaw/clawd';
const wsIdx = args.indexOf('--workspace');
if (wsIdx !== -1 && args[wsIdx + 1]) workspace = args[wsIdx + 1];

// Parse Ollama URL
let ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://100.114.49.119:11434';
const ollamaIdx = args.indexOf('--ollama-url');
if (ollamaIdx !== -1 && args[ollamaIdx + 1]) ollamaUrl = args[ollamaIdx + 1];

// Set for the ML modules
process.env.OLLAMA_BASE_URL = ollamaUrl;

const WHETSTONE_DIR = resolve(workspace, '.whetstone');
const STATE_FILE = resolve(WHETSTONE_DIR, 'state.json');
const LOG_FILE = resolve(WHETSTONE_DIR, 'auto-sense.log');
const LAST_RUN_FILE = resolve(WHETSTONE_DIR, 'auto-sense-last.json');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    if (!existsSync(WHETSTONE_DIR)) mkdirSync(WHETSTONE_DIR, { recursive: true });
    appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

async function main() {
  log(`auto-sense starting. workspace=${workspace} ollama=${ollamaUrl} dry_run=${DRY_RUN}`);

  // Step 1: Find the main session transcript
  const transcriptPath = findMainTranscript();
  if (!transcriptPath) {
    log('No main session transcript found. Exiting.');
    process.exit(0);
  }
  log(`Transcript: ${transcriptPath}`);

  // Step 2: Load last run state (to only process new messages)
  const lastRun = loadLastRun();
  const lastOffset = lastRun.lastOffset || 0;

  // Step 3: Read transcript and extract new user messages
  const messages = parseTranscript(transcriptPath, lastOffset);
  if (messages.userMessages.length === 0) {
    log(`No new user messages since offset ${lastOffset}. Exiting.`);
    process.exit(0);
  }
  log(`Found ${messages.userMessages.length} new user messages (offset ${lastOffset} -> ${messages.newOffset})`);

  // Step 4: Check Ollama availability
  const ollamaAvailable = await checkOllama();
  log(`Ollama available: ${ollamaAvailable}`);

  // Step 5: Run signal detection
  let signals = [];

  if (ollamaAvailable) {
    // Use ML classifier (embeddings + keywords)
    log('Using ML classifier (Ollama embeddings + keywords)');
    const { Whetstone } = await import('../dist/whetstone.js');
    // Use factory: connects to ThoughtLayer if configured, gracefully degrades if not
    const whetstone = await Whetstone.withThoughtLayer(workspace, 'vidura');
    await whetstone.init();

    for (const msg of messages.userMessages) {
      try {
        const signal = await whetstone.detectSignal(msg.content, msg.context || '');
        if (signal && signal.confidence !== 'low') {
          signals.push(signal);
          if (!DRY_RUN) {
            const id = await whetstone.addSignal(signal);
            log(`Signal detected [${signal.type}/${signal.confidence}]: "${msg.content.substring(0, 60)}..." -> ${id}`);
          } else {
            log(`[DRY] Signal detected [${signal.type}/${signal.confidence}]: "${msg.content.substring(0, 60)}..."`);
          }
        }
      } catch (err) {
        log(`Classifier error on message: ${err.message}`);
      }
    }

    // Step 6: Check for mutation candidates (clusters with 3+ signals)
    if (!DRY_RUN && signals.length > 0) {
      const candidates = whetstone.getMutationCandidates();
      log(`Mutation candidates (clusters with 3+ signals): ${candidates.length}`);

      if (candidates.length > 0) {
        // Log candidates for the weekly mutate cycle to pick up
        const candidatesPath = resolve(WHETSTONE_DIR, 'mutation-candidates.json');
        writeFileSync(candidatesPath, JSON.stringify(candidates.map(c => ({
          id: c.id,
          rootCause: c.rootCause,
          signalCount: c.signals.length,
          signalTypes: c.signals.map(s => s.signal.type),
        })), null, 2));
        log(`Wrote ${candidates.length} mutation candidates to ${candidatesPath}`);
      }
    }

    // Step 7: Get tool stats
    const stats = whetstone.getStats();
    log(`Stats: ${stats.totalSignals} signals, ${stats.totalMutations} mutations, ${stats.clusterStats.totalClusters} clusters`);

  } else {
    // Fallback: regex-only detection (no embeddings)
    log('Ollama unavailable. Using regex-only detection.');
    const { detectSignalPatterns } = await import('../dist/sense.js');

    for (const msg of messages.userMessages) {
      const detections = detectSignalPatterns(msg.content);
      for (const d of detections) {
        signals.push(d);
        log(`Signal detected [${d.type}/${d.confidence}] (regex): "${msg.content.substring(0, 60)}..."`);
      }
    }
  }

  // Step 8: Also process any pending execution traces
  try {
    const { Whetstone } = await import('../dist/whetstone.js');
    const whetstone = await Whetstone.withThoughtLayer(workspace, 'vidura');
    const pendingResults = await whetstone.analysePending();
    if (pendingResults.length > 0) {
      log(`Analysed ${pendingResults.length} pending execution traces`);
    }
  } catch (err) {
    log(`Trace analysis skipped: ${err.message}`);
  }

  // Step 9: Save last run state
  if (!DRY_RUN) {
    saveLastRun({ lastOffset: messages.newOffset, lastRun: new Date().toISOString(), signalsFound: signals.length });
  }

  log(`auto-sense complete. ${signals.length} signals from ${messages.userMessages.length} messages.`);
}

function findMainTranscript() {
  const sessionDirs = [
    resolve(process.env.HOME || '/home/openclaw', '.openclaw/agents/main/sessions'),
    workspace,
  ];

  for (const dir of sessionDirs) {
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.jsonl') && f.match(/^[0-9a-f]{8}-/));
      if (files.length === 0) continue;

      const sorted = files.map(f => {
        const p = resolve(dir, f);
        try {
          const stat = statSync(p);
          return { path: p, mtime: stat.mtimeMs };
        } catch { return null; }
      }).filter(Boolean).sort((a, b) => b.mtime - a.mtime);

      if (sorted[0]) return sorted[0].path;
    } catch {}
  }

  return null;
}

function parseTranscript(path, offset) {
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  const userMessages = [];

  let lastAssistantContent = '';

  for (let i = offset; i < lines.length; i++) {
    try {
      const entry = JSON.parse(lines[i]);
      
      // OpenClaw transcript format: {type: 'message', message: {role, content}}
      if (entry.type !== 'message' || !entry.message) continue;
      
      const msg = entry.message;
      const role = msg.role;
      const msgContent = msg.content;

      if (role === 'assistant') {
        // Extract text content for context
        if (typeof msgContent === 'string') {
          lastAssistantContent = msgContent.substring(0, 200);
        } else if (Array.isArray(msgContent)) {
          const textPart = msgContent.find(c => c.type === 'text');
          if (textPart) lastAssistantContent = textPart.text.substring(0, 200);
        }
      } else if (role === 'user') {
        let text = '';
        if (typeof msgContent === 'string') {
          text = msgContent;
        } else if (Array.isArray(msgContent)) {
          const textPart = msgContent.find(c => c.type === 'text');
          if (textPart) text = textPart.text;
        }

        // Skip system-like messages (heartbeats, etc.)
        if (text && !text.startsWith('Read HEARTBEAT.md') && !text.startsWith('[System')) {
          userMessages.push({
            content: text,
            context: lastAssistantContent,
            lineIndex: i,
          });
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return {
    userMessages,
    newOffset: lines.length,
  };
}

async function checkOllama() {
  try {
    const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    return resp.ok;
  } catch {
    return false;
  }
}

function loadLastRun() {
  try {
    if (existsSync(LAST_RUN_FILE)) {
      return JSON.parse(readFileSync(LAST_RUN_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function saveLastRun(state) {
  try {
    if (!existsSync(WHETSTONE_DIR)) mkdirSync(WHETSTONE_DIR, { recursive: true });
    writeFileSync(LAST_RUN_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  process.exit(1);
});
