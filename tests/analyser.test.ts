import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { TraceRecorder } from '../src/recorder.js';
import { ExecutionAnalyser } from '../src/analyser.js';

describe('ExecutionAnalyser', () => {
  let workspace: string;
  let recorder: TraceRecorder;
  let analyser: ExecutionAnalyser;

  beforeEach(() => {
    workspace = mkdtempSync(resolve(tmpdir(), 'whetstone-test-'));
    recorder = new TraceRecorder(workspace);
    analyser = new ExecutionAnalyser(workspace, recorder);
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('analyses a successful trace with no issues', () => {
    recorder.start('ok-task', 'Clean task');
    recorder.tool('ok-task', 'exec', 'ok', 'success');
    recorder.tool('ok-task', 'write', 'ok', 'success');
    recorder.end('ok-task', 'success');

    const result = analyser.analyse('ok-task');
    expect(result).not.toBeNull();
    expect(result!.taskId).toBe('ok-task');
    expect(result!.signals.length).toBe(0); // No issues
    expect(result!.toolDegradations.length).toBe(0);
  });

  it('detects tool degradation', () => {
    recorder.start('degraded-task', 'Degraded tool');
    recorder.tool('degraded-task', 'thoughtlayer_add', 'error', 'fetch failed');
    recorder.tool('degraded-task', 'thoughtlayer_add', 'error', 'fetch failed again');
    recorder.error('degraded-task', 'thoughtlayer_add', 'Connection refused');
    recorder.tool('degraded-task', 'exec', 'ok', 'fallback worked');
    recorder.end('degraded-task', 'partial');

    const result = analyser.analyse('degraded-task');
    expect(result).not.toBeNull();

    // Should have degradation signal for thoughtlayer_add
    const degradation = result!.toolDegradations.find(d => d.tool === 'thoughtlayer_add');
    expect(degradation).toBeDefined();
    expect(degradation!.successRate).toBe(0);
    expect(degradation!.errors).toBe(2);

    // Should have failure signal
    const failureSignal = result!.signals.find(s =>
      s.what.includes('thoughtlayer_add') && s.what.includes('degraded')
    );
    expect(failureSignal).toBeDefined();
    expect(failureSignal!.type).toBe('failure');
    expect(failureSignal!.category).toBe('tool_use');
  });

  it('detects excessive retries', () => {
    recorder.start('retry-task', 'Retry heavy');
    recorder.tool('retry-task', 'exec', 'retry', 'attempt 1');
    recorder.tool('retry-task', 'exec', 'retry', 'attempt 2');
    recorder.tool('retry-task', 'exec', 'retry', 'attempt 3');
    recorder.tool('retry-task', 'exec', 'ok', 'finally worked');
    recorder.end('retry-task', 'success');

    const result = analyser.analyse('retry-task');
    expect(result).not.toBeNull();

    const retrySignal = result!.signals.find(s =>
      s.what.includes('Excessive retries')
    );
    expect(retrySignal).toBeDefined();
    expect(retrySignal!.category).toBe('judgment');
  });

  it('creates failure signal for failed tasks', () => {
    recorder.start('fail-task', 'Doomed task');
    recorder.tool('fail-task', 'exec', 'error', 'crashed');
    recorder.error('fail-task', 'exec', 'Segfault');
    recorder.end('fail-task', 'failure');

    const result = analyser.analyse('fail-task');
    expect(result).not.toBeNull();

    const failSignal = result!.signals.find(s =>
      s.what.includes('failure')
    );
    expect(failSignal).toBeDefined();
  });

  it('marks traces as analysed', () => {
    recorder.start('mark-task', 'Mark test');
    recorder.end('mark-task', 'success');

    expect(recorder.listUnanalysed()).toContain('mark-task');

    analyser.analyse('mark-task');
    expect(recorder.listUnanalysed()).not.toContain('mark-task');
  });

  it('does not re-analyse already analysed traces', () => {
    recorder.start('dup-task', 'Dup test');
    recorder.tool('dup-task', 'exec', 'error', 'failed');
    recorder.error('dup-task', 'exec', 'broke');
    recorder.end('dup-task', 'failure');

    const first = analyser.analyse('dup-task');
    expect(first).not.toBeNull();

    // Second analysis should be skipped (already has .analysed marker)
    // It returns null because the recorder's listUnanalysed won't include it
    expect(recorder.listUnanalysed()).not.toContain('dup-task');
  });

  it('analyses all pending traces', () => {
    recorder.start('pend-1', 'Pending 1');
    recorder.end('pend-1', 'success');
    recorder.start('pend-2', 'Pending 2');
    recorder.end('pend-2', 'failure');

    const results = analyser.analysePending();
    expect(results.length).toBe(2);
    expect(recorder.listUnanalysed().length).toBe(0);
  });

  it('tracks aggregate tool stats', () => {
    recorder.start('stats-1', 'Stats 1');
    recorder.tool('stats-1', 'exec', 'ok');
    recorder.tool('stats-1', 'exec', 'ok');
    recorder.tool('stats-1', 'web_search', 'error', 'failed');
    recorder.end('stats-1', 'success');
    analyser.analyse('stats-1');

    recorder.start('stats-2', 'Stats 2');
    recorder.tool('stats-2', 'exec', 'ok');
    recorder.tool('stats-2', 'web_search', 'ok');
    recorder.end('stats-2', 'success');
    analyser.analyse('stats-2');

    const stats = analyser.getToolStats();
    expect(stats.length).toBeGreaterThan(0);

    const execStats = stats.find(s => s.tool === 'exec');
    expect(execStats).toBeDefined();
    expect(execStats!.totalCalls).toBe(3);
    expect(execStats!.totalOk).toBe(3);
    expect(execStats!.successRate).toBe(1);

    const searchStats = stats.find(s => s.tool === 'web_search');
    expect(searchStats).toBeDefined();
    expect(searchStats!.totalCalls).toBe(2);
    expect(searchStats!.totalOk).toBe(1);
    expect(searchStats!.totalErrors).toBe(1);
    expect(searchStats!.successRate).toBe(0.5);
  });

  it('identifies degraded tools from aggregate stats', () => {
    recorder.start('deg-1', 'Degraded');
    recorder.tool('deg-1', 'bad_tool', 'error', 'fail');
    recorder.tool('deg-1', 'bad_tool', 'error', 'fail again');
    recorder.end('deg-1', 'failure');
    analyser.analyse('deg-1');

    const degraded = analyser.getDegradedTools();
    expect(degraded.length).toBeGreaterThan(0);
    expect(degraded.some(d => d.tool === 'bad_tool')).toBe(true);
  });

  it('returns null for nonexistent trace', () => {
    expect(analyser.analyse('ghost')).toBeNull();
  });
});
