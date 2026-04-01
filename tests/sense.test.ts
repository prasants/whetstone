import { describe, it, expect } from 'vitest';
import {
  detectSignalPatterns,
  analyseConversation,
  buildSignalTemplate,
  ConversationTurn,
} from '../src/sense.js';

describe('detectSignalPatterns', () => {
  describe('corrections', () => {
    it('detects "no, I meant"', () => {
      const results = detectSignalPatterns('No, I meant the other file');
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('correction');
      expect(results[0].confidence).toBe('high');
    });

    it('detects "actually"', () => {
      const results = detectSignalPatterns('Actually, use the node runner');
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('correction');
    });

    it('detects "that\'s wrong"', () => {
      const results = detectSignalPatterns("That's wrong, the amount is $50k");
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('correction');
    });

    it('detects "wrong tool"', () => {
      const results = detectSignalPatterns('Wrong tool, use curl instead');
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('correction');
    });

    it('does not flag user self-correction', () => {
      const results = detectSignalPatterns('I was wrong about the deadline');
      // Should not detect as agent correction
      const corrections = results.filter((r) => r.type === 'correction');
      expect(corrections).toHaveLength(0);
    });
  });

  describe('frustration', () => {
    it('detects profanity', () => {
      const results = detectSignalPatterns('What the fuck is this');
      expect(results.some((r) => r.type === 'frustration')).toBe(true);
    });

    it('detects "I already told you"', () => {
      const results = detectSignalPatterns('I already told you not to use SSH');
      expect(results.some((r) => r.type === 'frustration')).toBe(true);
    });

    it('detects ALL CAPS', () => {
      const results = detectSignalPatterns('STOP DOING THAT RIGHT NOW');
      expect(results.some((r) => r.type === 'frustration')).toBe(true);
    });

    it('does not flag short caps', () => {
      const results = detectSignalPatterns('Use the API key');
      const frustrations = results.filter((r) => r.type === 'frustration');
      expect(frustrations).toHaveLength(0);
    });
  });

  describe('takeover', () => {
    it('detects "let me just do it"', () => {
      const results = detectSignalPatterns("Let me just do it myself");
      expect(results.some((r) => r.type === 'takeover')).toBe(true);
    });

    it('detects "never mind, I\'ll"', () => {
      const results = detectSignalPatterns("Never mind, I'll handle it");
      expect(results.some((r) => r.type === 'takeover')).toBe(true);
    });

    it('detects "forget it, I"', () => {
      const results = detectSignalPatterns("Forget it, I'll run the command");
      expect(results.some((r) => r.type === 'takeover')).toBe(true);
    });
  });

  describe('style', () => {
    it('detects formatting requests', () => {
      const results = detectSignalPatterns('Format it like a table');
      expect(results.some((r) => r.type === 'style')).toBe(true);
    });

    it('detects verbosity complaints', () => {
      const results = detectSignalPatterns("That's too verbose");
      expect(results.some((r) => r.type === 'style')).toBe(true);
    });
  });

  describe('success', () => {
    it('detects "perfect"', () => {
      const results = detectSignalPatterns('Perfect, exactly what I needed');
      expect(results.some((r) => r.type === 'success')).toBe(true);
    });

    it('detects "spot on"', () => {
      const results = detectSignalPatterns("That's spot on");
      expect(results.some((r) => r.type === 'success')).toBe(true);
    });

    it('does not flag "perfect, but..."', () => {
      const results = detectSignalPatterns('Perfect, but can you also add X');
      const successes = results.filter((r) => r.type === 'success');
      expect(successes).toHaveLength(0);
    });
  });

  describe('no signals', () => {
    it('returns empty for neutral messages', () => {
      const results = detectSignalPatterns('What time is the meeting tomorrow?');
      expect(results).toHaveLength(0);
    });

    it('returns empty for simple requests', () => {
      const results = detectSignalPatterns('Check the calendar for Friday');
      expect(results).toHaveLength(0);
    });
  });

  describe('regression: ReDoS protection', () => {
    it('handles long ALL-CAPS strings without catastrophic backtracking', () => {
      const start = performance.now();
      const input = 'A'.repeat(100) + ' ' + 'B'.repeat(100);
      detectSignalPatterns(input);
      const elapsed = performance.now() - start;
      // Must complete in < 100ms (ReDoS would take seconds/minutes)
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('regression: success with "but" elsewhere in message', () => {
    it('detects success when "but" is unrelated to the positive match', () => {
      // "but" appears but NOT adjacent to the success word
      const results = detectSignalPatterns('I tried but failed, then you nailed it');
      expect(results.some((r) => r.type === 'success')).toBe(true);
    });
  });
});

describe('analyseConversation deduplication', () => {
  it('returns at most one signal per type per turn (regression: duplicate signals)', () => {
    const turns: ConversationTurn[] = [
      { role: 'user', content: 'Perfect perfect perfect, exactly what I wanted, spot on' },
    ];

    const results = analyseConversation(turns);
    const successCount = results.filter((r) => r.detection.type === 'success').length;
    expect(successCount).toBe(1); // Was 3 before dedup fix
  });
});

describe('analyseConversation', () => {
  it('detects signals with context from preceding assistant message', () => {
    const turns: ConversationTurn[] = [
      { role: 'assistant', content: 'I\'ll SSH into the Mac to run that command.' },
      { role: 'user', content: 'No, I meant use nodes.run, not SSH' },
    ];

    const results = analyseConversation(turns);
    expect(results).toHaveLength(1);
    expect(results[0].detection.type).toBe('correction');
    expect(results[0].context).toContain('SSH');
  });

  it('ignores assistant messages', () => {
    const turns: ConversationTurn[] = [
      { role: 'assistant', content: 'Actually, I should use a different approach' },
    ];

    const results = analyseConversation(turns);
    expect(results).toHaveLength(0);
  });

  it('handles multiple signals in one conversation', () => {
    const turns: ConversationTurn[] = [
      { role: 'assistant', content: 'Here is the report.' },
      { role: 'user', content: "That's too verbose, cut it in half" },
      { role: 'assistant', content: 'Here is the shorter version.' },
      { role: 'user', content: 'Perfect, thanks' },
    ];

    const results = analyseConversation(turns);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const types = results.map((r) => r.detection.type);
    expect(types).toContain('style');
    expect(types).toContain('success');
  });
});

describe('buildSignalTemplate', () => {
  it('creates a partial signal with correct fields', () => {
    const detection = {
      type: 'correction' as const,
      category: 'tool_use' as const,
      confidence: 'high' as const,
      matchedPattern: 'No, I meant',
    };

    const template = buildSignalTemplate(detection, 'Used SSH to connect', '2026-03-27');
    expect(template.type).toBe('correction');
    expect(template.category).toBe('tool_use');
    expect(template.confidence).toBe('high');
    expect(template.sessionDate).toBe('2026-03-27');
    expect(template.context).toBe('Used SSH to connect');
  });

  it('truncates long context to 150 chars', () => {
    const longContext = 'A'.repeat(200);
    const detection = {
      type: 'failure' as const,
      category: 'tool_use' as const,
      confidence: 'medium' as const,
      matchedPattern: 'error',
    };

    const template = buildSignalTemplate(detection, longContext, '2026-03-27');
    expect(template.context!.length).toBeLessThanOrEqual(150);
  });
});
