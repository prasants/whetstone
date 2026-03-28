import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { TraceRecorder } from '../src/recorder.js';

describe('TraceRecorder', () => {
  let workspace: string;
  let recorder: TraceRecorder;

  beforeEach(() => {
    workspace = mkdtempSync(resolve(tmpdir(), 'whetstone-test-'));
    recorder = new TraceRecorder(workspace);
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('creates trace directory on init', () => {
    const { existsSync } = require('fs');
    expect(existsSync(resolve(workspace, '.whetstone', 'traces'))).toBe(true);
  });

  it('records a complete task lifecycle', () => {
    recorder.start('task-1', 'Test task', 'vidura');
    recorder.tool('task-1', 'exec', 'ok', 'ran a command');
    recorder.tool('task-1', 'write', 'ok', 'wrote a file');
    recorder.tool('task-1', 'exec', 'error', 'command failed');
    recorder.error('task-1', 'exec', 'permission denied');
    recorder.tool('task-1', 'exec', 'retry', 'retrying with sudo');
    recorder.tool('task-1', 'exec', 'ok', 'worked with sudo');
    const endEvent = recorder.end('task-1', 'success', 'Task completed');

    expect(endEvent.totalTools).toBe(5);
    expect(endEvent.ok).toBe(3);
    expect(endEvent.errors).toBe(1);
    expect(endEvent.retries).toBe(1);
    expect(endEvent.outcome).toBe('success');
    expect(endEvent.errorEvents).toBe(1);
  });

  it('loads a trace', () => {
    recorder.start('task-2', 'Load test');
    recorder.tool('task-2', 'read', 'ok', 'read file');
    recorder.end('task-2', 'success');

    const events = recorder.loadTrace('task-2');
    expect(events.length).toBe(3);
    expect(events[0].type).toBe('start');
    expect(events[1].type).toBe('tool');
    expect(events[2].type).toBe('end');
  });

  it('summarises a completed trace', () => {
    recorder.start('task-3', 'Summary test', 'kubera');
    recorder.tool('task-3', 'web_search', 'ok', 'searched');
    recorder.tool('task-3', 'web_search', 'error', 'rate limited');
    recorder.tool('task-3', 'web_fetch', 'ok', 'fetched');
    recorder.error('task-3', 'web_search', 'Rate limit exceeded');
    recorder.end('task-3', 'partial', 'Some results');

    const summary = recorder.summarise('task-3');
    expect(summary).not.toBeNull();
    expect(summary!.taskId).toBe('task-3');
    expect(summary!.agent).toBe('kubera');
    expect(summary!.outcome).toBe('partial');
    expect(summary!.totalTools).toBe(3);
    expect(summary!.toolStats.length).toBe(2); // web_search, web_fetch
    expect(summary!.errorMessages).toContain('Rate limit exceeded');

    const searchStats = summary!.toolStats.find(t => t.tool === 'web_search');
    expect(searchStats!.total).toBe(2);
    expect(searchStats!.ok).toBe(1);
    expect(searchStats!.errors).toBe(1);
    expect(searchStats!.successRate).toBe(0.5);
  });

  it('lists completed traces', () => {
    recorder.start('task-a', 'First');
    recorder.end('task-a', 'success');

    recorder.start('task-b', 'Second');
    // No end event — not completed

    const completed = recorder.listCompleted();
    expect(completed).toContain('task-a');
    expect(completed).not.toContain('task-b');
  });

  it('tracks unanalysed traces', () => {
    recorder.start('task-x', 'Unanalysed');
    recorder.end('task-x', 'success');

    expect(recorder.listUnanalysed()).toContain('task-x');

    recorder.markAnalysed('task-x');
    expect(recorder.listUnanalysed()).not.toContain('task-x');
  });

  it('tracks active recordings', () => {
    recorder.start('task-active', 'Active task');
    expect(recorder.isRecording('task-active')).toBe(true);
    expect(recorder.isRecording('task-nonexistent')).toBe(false);

    recorder.end('task-active', 'success');
    expect(recorder.isRecording('task-active')).toBe(false);
  });

  it('returns null summary for empty trace', () => {
    expect(recorder.summarise('nonexistent')).toBeNull();
  });

  it('truncates long detail strings', () => {
    recorder.start('task-trunc', 'Truncation test');
    const longDetail = 'x'.repeat(1000);
    recorder.tool('task-trunc', 'exec', 'ok', longDetail);
    recorder.end('task-trunc', 'success');

    const events = recorder.loadTrace('task-trunc');
    const toolEvent = events.find(e => e.type === 'tool');
    expect((toolEvent as any).detail.length).toBeLessThanOrEqual(500);
  });

  it('handles duration tracking', () => {
    recorder.start('task-dur', 'Duration test');
    recorder.tool('task-dur', 'exec', 'ok', 'fast', 150);
    recorder.tool('task-dur', 'exec', 'ok', 'slow', 5000);
    recorder.end('task-dur', 'success');

    const events = recorder.loadTrace('task-dur');
    const toolEvents = events.filter(e => e.type === 'tool');
    expect((toolEvents[0] as any).durationMs).toBe(150);
    expect((toolEvents[1] as any).durationMs).toBe(5000);
  });
});
