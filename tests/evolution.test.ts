import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { SkillEvolver } from '../src/evolution.js';
import type { EvolutionSuggestion, EvolutionRecord } from '../src/evolution.js';
import type { AnalysisResult, ToolDegradation } from '../src/analyser.js';
import type { Signal } from '../src/types.js';

describe('SkillEvolver', () => {
  let workspace: string;
  let skillsDir: string;
  let evolver: SkillEvolver;

  beforeEach(() => {
    workspace = mkdtempSync(resolve(tmpdir(), 'whetstone-evo-'));
    skillsDir = resolve(workspace, 'skills');
    mkdirSync(skillsDir, { recursive: true });

    // Create sample skills
    mkdirSync(resolve(skillsDir, 'web-search'));
    writeFileSync(
      resolve(skillsDir, 'web-search', 'SKILL.md'),
      '# Web Search\nUses web_search and web_fetch tools.\n'
    );

    mkdirSync(resolve(skillsDir, 'draft-scorer'));
    writeFileSync(
      resolve(skillsDir, 'draft-scorer', 'SKILL.md'),
      '# Draft Scorer\nScores drafts against voice rules.\n'
    );

    evolver = new SkillEvolver(workspace, skillsDir);
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  describe('suggestFromAnalysis', () => {
    it('suggests FIX for degraded tools', () => {
      const analysis: AnalysisResult = {
        taskId: 'test-1',
        signals: [],
        toolDegradations: [{
          tool: 'web_search',
          successRate: 0.3,
          totalCalls: 10,
          errors: 7,
          lastError: 'Rate limit exceeded',
          severity: 'warning',
        }],
        summary: 'partial',
        analysedAt: new Date().toISOString(),
      };

      const suggestions = evolver.suggestFromAnalysis(analysis);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].type).toBe('fix');
      expect(suggestions[0].targetSkill).toBe('web-search');
      expect(suggestions[0].trigger).toBe('tool_degradation');
    });

    it('suggests CAPTURED for novel failure patterns', () => {
      const analysis: AnalysisResult = {
        taskId: 'test-2',
        signals: [{
          type: 'failure',
          what: 'SSH connection failed to remote host',
          rootCause: 'SSH key not configured for new server',
          suggestedRule: 'Check SSH access before attempting remote commands',
          confidence: 'high',
          category: 'tool_use',
          context: 'Remote deployment task',
          sessionDate: '2026-03-28',
          toolsInvolved: ['exec'],
          filesInvolved: [],
        }],
        toolDegradations: [],
        summary: 'failure',
        analysedAt: new Date().toISOString(),
      };

      const suggestions = evolver.suggestFromAnalysis(analysis);
      const captured = suggestions.find(s => s.type === 'captured');
      expect(captured).toBeDefined();
      expect(captured!.trigger).toBe('analysis');
    });
  });

  describe('suggestFromClusters', () => {
    it('suggests DERIVED for existing skills with new evidence', () => {
      const clusters = [{
        rootCause: 'web search rate limiting and fetch failures',
        signals: [
          { type: 'failure' as const, what: 'web_search rate limited', rootCause: 'too many calls', suggestedRule: 'add delay', confidence: 'high' as const, category: 'tool_use' as const, context: '', sessionDate: '2026-03-28', toolsInvolved: ['web_search'], filesInvolved: [] },
          { type: 'failure' as const, what: 'web_search timeout', rootCause: 'slow response', suggestedRule: 'add timeout', confidence: 'medium' as const, category: 'tool_use' as const, context: '', sessionDate: '2026-03-28', toolsInvolved: ['web_search'], filesInvolved: [] },
          { type: 'failure' as const, what: 'web_fetch 404', rootCause: 'dead link', suggestedRule: 'validate URLs', confidence: 'medium' as const, category: 'tool_use' as const, context: '', sessionDate: '2026-03-28', toolsInvolved: ['web_fetch'], filesInvolved: [] },
        ],
        count: 3,
      }];

      const suggestions = evolver.suggestFromClusters(clusters);
      expect(suggestions.length).toBeGreaterThan(0);
      // Should match 'web-search' skill since cluster mentions web search/fetch
      expect(suggestions.some(s => s.type === 'derived' || s.type === 'captured')).toBe(true);
    });

    it('suggests CAPTURED for novel patterns with no matching skill', () => {
      const clusters = [{
        rootCause: 'kubernetes pod scheduling failures in production',
        signals: [
          { type: 'failure' as const, what: 'pod stuck pending', rootCause: 'resource quota', suggestedRule: 'check quotas', confidence: 'high' as const, category: 'tool_use' as const, context: '', sessionDate: '2026-03-28', toolsInvolved: [], filesInvolved: [] },
        ],
        count: 4,
      }];

      const suggestions = evolver.suggestFromClusters(clusters);
      const captured = suggestions.find(s => s.type === 'captured');
      expect(captured).toBeDefined();
    });
  });

  describe('execute', () => {
    it('executes FIX evolution with snapshot', () => {
      const suggestion: EvolutionSuggestion = {
        type: 'fix',
        trigger: 'tool_degradation',
        targetSkill: 'web-search',
        direction: 'Add rate limiting retry logic',
        evidence: '7/10 calls failed',
        priority: 0.8,
      };

      const originalContent = readFileSync(resolve(skillsDir, 'web-search', 'SKILL.md'), 'utf8');
      const newContent = '# Web Search\nUses web_search with rate limit handling.\nRetry after 1s on 429.\n';

      const record = evolver.execute(suggestion, newContent, ['S-1', 'S-2']);

      expect(record.type).toBe('fix');
      expect(record.targetSkill).toBe('web-search');
      expect(record.signals).toEqual(['S-1', 'S-2']);
      expect(record.snapshot).toBeDefined();

      // Verify SKILL.md was updated
      const updated = readFileSync(resolve(skillsDir, 'web-search', 'SKILL.md'), 'utf8');
      expect(updated).toContain('rate limit handling');

      // Verify snapshot exists
      expect(existsSync(resolve(record.snapshot!, 'SKILL.md'))).toBe(true);
      const snapshotContent = readFileSync(resolve(record.snapshot!, 'SKILL.md'), 'utf8');
      expect(snapshotContent).toBe(originalContent);
    });

    it('executes DERIVED evolution creating new skill', () => {
      const suggestion: EvolutionSuggestion = {
        type: 'derived',
        trigger: 'signal_cluster',
        targetSkill: 'web-search',
        direction: 'Enhanced version with caching',
        evidence: '5 signals about repeated searches',
        priority: 0.7,
      };

      const newContent = '# Web Search v2\nCached web search with dedup.\n';
      const record = evolver.execute(suggestion, newContent);

      expect(record.type).toBe('derived');
      expect(record.parentSkill).toBe('web-search');
      expect(record.targetSkill).toMatch(/^web-search-v\d+$/);

      // Verify new skill directory created
      expect(existsSync(resolve(skillsDir, record.targetSkill, 'SKILL.md'))).toBe(true);
    });

    it('executes CAPTURED evolution creating brand new skill', () => {
      const suggestion: EvolutionSuggestion = {
        type: 'captured',
        trigger: 'analysis',
        targetSkill: 'ssh-preflight-check',
        direction: 'Capture SSH connectivity check pattern',
        evidence: '3 failures from missing SSH access',
        priority: 0.6,
      };

      const content = '# SSH Preflight Check\nBefore any SSH command, verify connectivity.\n';
      const record = evolver.execute(suggestion, content);

      expect(record.type).toBe('captured');
      expect(existsSync(resolve(skillsDir, 'ssh-preflight-check', 'SKILL.md'))).toBe(true);
    });
  });

  describe('rollback', () => {
    it('rolls back a FIX evolution', () => {
      const suggestion: EvolutionSuggestion = {
        type: 'fix',
        trigger: 'tool_degradation',
        targetSkill: 'web-search',
        direction: 'Bad fix',
        evidence: 'test',
        priority: 0.5,
      };

      const original = readFileSync(resolve(skillsDir, 'web-search', 'SKILL.md'), 'utf8');
      const record = evolver.execute(suggestion, 'BROKEN CONTENT');

      // Verify it's broken
      expect(readFileSync(resolve(skillsDir, 'web-search', 'SKILL.md'), 'utf8')).toBe('BROKEN CONTENT');

      // Rollback
      const success = evolver.rollback(record.id);
      expect(success).toBe(true);

      // Verify restored
      expect(readFileSync(resolve(skillsDir, 'web-search', 'SKILL.md'), 'utf8')).toBe(original);
    });

    it('returns false for nonexistent evolution', () => {
      expect(evolver.rollback('E-nonexistent')).toBe(false);
    });
  });

  describe('history', () => {
    it('tracks evolution history', () => {
      const suggestion: EvolutionSuggestion = {
        type: 'captured',
        trigger: 'analysis',
        targetSkill: 'test-skill',
        direction: 'test',
        evidence: 'test',
        priority: 0.5,
      };

      evolver.execute(suggestion, '# Test Skill\n');
      evolver.execute({ ...suggestion, targetSkill: 'test-skill-2' }, '# Test 2\n');

      const history = evolver.getHistory();
      expect(history.length).toBe(2);
    });

    it('persists history across instances', () => {
      const suggestion: EvolutionSuggestion = {
        type: 'captured',
        trigger: 'analysis',
        targetSkill: 'persist-test',
        direction: 'test',
        evidence: 'test',
        priority: 0.5,
      };

      evolver.execute(suggestion, '# Persist\n');

      // Create new evolver instance (simulating restart)
      const evolver2 = new SkillEvolver(workspace, skillsDir);
      const history = evolver2.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].targetSkill).toBe('persist-test');
    });
  });

  describe('skill health', () => {
    it('reports health for all skills', () => {
      const health = evolver.getSkillHealth();
      expect(health.length).toBe(2); // web-search, draft-scorer
      expect(health.some(h => h.skillName === 'web-search')).toBe(true);
      expect(health.some(h => h.skillName === 'draft-scorer')).toBe(true);
    });
  });
});
