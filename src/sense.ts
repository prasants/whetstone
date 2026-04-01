/**
 * Signal extraction from conversations.
 *
 * The sense module detects improvement signals by analysing
 * conversation patterns. Currently rule-based; the ML classifier
 * (roadmap) will replace the prompt-based extraction.
 */

import {
  Signal,
  SignalType,
  SignalCategory,
  Confidence,
} from './types.js';

// ── Pattern Definitions ─────────────────────────────────────────

interface DetectionPattern {
  type: SignalType;
  patterns: RegExp[];
  negativePatterns?: RegExp[];
  category: SignalCategory;
  confidence: Confidence;
}

/**
 * Built-in detection patterns for each signal type.
 *
 * These are intentionally conservative — it's better to miss a
 * signal than to generate a false positive. The ML classifier
 * will improve recall without sacrificing precision.
 */
const DETECTION_PATTERNS: DetectionPattern[] = [
  {
    type: 'correction',
    patterns: [
      /\bno[,.]?\s+(I\s+)?(meant|want|need)/i,
      /\bactually[,.]?\s/i,
      /\bthat'?s\s+(wrong|incorrect|not\s+right)/i,
      /\bI\s+said\b/i,
      /\bnot\s+what\s+I\s+(asked|wanted|meant)/i,
      /\bwrong\s+(file|tool|command|approach|method)/i,
    ],
    negativePatterns: [
      /\bI\s+was\s+wrong/i,  // User correcting themselves, not the agent
    ],
    category: 'judgment',
    confidence: 'high',
  },
  {
    type: 'frustration',
    patterns: [
      /\bf+u+c+k/i,
      /\bdumbf/i,
      /\bfor\s+f+.+\s+sake/i,
      /\bI\s+(already|just)\s+told\s+you/i,
      /[A-Z ]{10,}/,  // Extended ALL CAPS (avoid \s to prevent ReDoS)
      /\bhow\s+many\s+times/i,
    ],
    category: 'judgment',
    confidence: 'high',
  },
  {
    type: 'takeover',
    patterns: [
      /\b(let\s+me|I'?ll)\s+(just\s+)?(do|handle|run|fix)\s+(it|this)/i,
      /\bnever\s*mind[,.]?\s*I'?ll/i,
      /\bforget\s+it[,.]?\s*I/i,
    ],
    category: 'tool_use',
    confidence: 'medium',
  },
  {
    type: 'style',
    patterns: [
      /\b(format|write|rewrite|rephrase)\s+(it|this|that)\s+(like|as)/i,
      /\btoo\s+(long|short|verbose|brief|wordy)/i,
      /\b(use|prefer)\s+(bullet|table|list|markdown|plain)/i,
    ],
    category: 'style',
    confidence: 'medium',
  },
  {
    type: 'success',
    patterns: [
      /\b(perfect|exactly|brilliant|spot\s+on|nailed\s+it)\b/i,
      /\bthanks?[,.]?\s+(that'?s|this\s+is)\s+(great|perfect|exactly)/i,
      /\bgood\s+(job|work)\b/i,
    ],
    negativePatterns: [
      /\b(perfect|great|exactly)\b.*\bbut\b/i,  // "Perfect, but..." is qualified, not pure success
    ],
    category: 'judgment',
    confidence: 'medium',
  },
];

// ── Signal Detection ────────────────────────────────────────────

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

/**
 * Detect signals in a single user message.
 *
 * Returns detected signal types with their patterns. Does not
 * construct full Signal objects — that requires root cause analysis
 * from the LLM or classifier.
 */
export function detectSignalPatterns(
  message: string,
): { type: SignalType; category: SignalCategory; confidence: Confidence; matchedPattern: string }[] {
  const detected: { type: SignalType; category: SignalCategory; confidence: Confidence; matchedPattern: string }[] = [];

  for (const pattern of DETECTION_PATTERNS) {
    // Check positive patterns
    let matched = false;
    let matchedStr = '';

    for (const regex of pattern.patterns) {
      const match = message.match(regex);
      if (match) {
        matched = true;
        matchedStr = match[0];
        break;
      }
    }

    if (!matched) continue;

    // Check negative patterns (exclusions)
    if (pattern.negativePatterns) {
      const excluded = pattern.negativePatterns.some((r) => r.test(message));
      if (excluded) continue;
    }

    detected.push({
      type: pattern.type,
      category: pattern.category,
      confidence: pattern.confidence,
      matchedPattern: matchedStr,
    });
  }

  return detected;
}

/**
 * Analyse a full conversation for signals.
 *
 * Scans user messages for patterns, then uses context
 * (the assistant's preceding message) to assess root cause.
 */
export function analyseConversation(
  turns: ConversationTurn[],
): { turnIndex: number; detection: ReturnType<typeof detectSignalPatterns>[number]; context: string }[] {
  const results: { turnIndex: number; detection: ReturnType<typeof detectSignalPatterns>[number]; context: string }[] = [];

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.role !== 'user') continue;

    const detections = detectSignalPatterns(turn.content);
    if (detections.length === 0) continue;

    // Grab context: the assistant message before this one
    const prevAssistant = i > 0 && turns[i - 1].role === 'assistant'
      ? turns[i - 1].content.substring(0, 150)
      : '';

    // Deduplicate: only one signal per type per turn
    const seen = new Set<SignalType>();
    for (const detection of detections) {
      if (seen.has(detection.type)) continue;
      seen.add(detection.type);
      results.push({
        turnIndex: i,
        detection,
        context: prevAssistant,
      });
    }
  }

  return results;
}

/**
 * Build a Signal object from a detection result.
 *
 * The rootCause and suggestedRule require LLM analysis for
 * quality results. This function provides a template that the
 * sense prompt or classifier can fill in.
 */
export function buildSignalTemplate(
  detection: ReturnType<typeof detectSignalPatterns>[number],
  context: string,
  sessionDate: string,
): Partial<Signal> {
  return {
    type: detection.type,
    confidence: detection.confidence,
    category: detection.category,
    context: context.substring(0, 150),
    sessionDate,
    toolsInvolved: [],
    filesInvolved: [],
  };
}
