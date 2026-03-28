/**
 * TraceRecorder — Automatic execution trace recording.
 *
 * Records tool calls, errors, retries, and outcomes for every task.
 * Traces are stored as JSONL files in .whetstone/traces/<taskId>.jsonl.
 *
 * Inspired by OpenSpace's RecordingManager + TrajectoryRecorder.
 */

import { existsSync, appendFileSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { resolve, basename } from 'path';

// ── Types ───────────────────────────────────────────────────────

export type TraceEventType = 'start' | 'tool' | 'error' | 'end';
export type ToolStatus = 'ok' | 'error' | 'retry' | 'timeout';
export type TaskOutcome = 'success' | 'failure' | 'partial' | 'abandoned';

export interface TraceEvent {
  ts: string;
  type: TraceEventType;
  taskId: string;
  [key: string]: unknown;
}

export interface StartEvent extends TraceEvent {
  type: 'start';
  description: string;
  agent: string;
}

export interface ToolEvent extends TraceEvent {
  type: 'tool';
  tool: string;
  status: ToolStatus;
  detail: string;
  durationMs?: number;
}

export interface ErrorEvent extends TraceEvent {
  type: 'error';
  tool: string;
  error: string;
}

export interface EndEvent extends TraceEvent {
  type: 'end';
  outcome: TaskOutcome;
  summary: string;
  startTs: string;
  durationMs: number;
  totalTools: number;
  ok: number;
  errors: number;
  retries: number;
  errorEvents: number;
}

export interface ToolStats {
  tool: string;
  total: number;
  ok: number;
  errors: number;
  retries: number;
  timeouts: number;
  successRate: number;
}

export interface TraceSummary {
  taskId: string;
  description: string;
  agent: string;
  outcome: TaskOutcome;
  startTs: string;
  endTs: string;
  durationMs: number;
  totalTools: number;
  ok: number;
  errors: number;
  retries: number;
  toolStats: ToolStats[];
  errorMessages: string[];
  events: TraceEvent[];
}

// ── Recorder ────────────────────────────────────────────────────

export class TraceRecorder {
  private traceDir: string;
  private activeTraces: Map<string, string> = new Map(); // taskId → filePath

  constructor(workspace: string) {
    this.traceDir = resolve(workspace, '.whetstone', 'traces');
    mkdirSync(this.traceDir, { recursive: true });
  }

  /**
   * Start recording a new task.
   */
  start(taskId: string, description: string, agent: string = 'default'): void {
    const filePath = resolve(this.traceDir, `${taskId}.jsonl`);
    this.activeTraces.set(taskId, filePath);

    const event: StartEvent = {
      ts: new Date().toISOString(),
      type: 'start',
      taskId,
      description,
      agent,
    };

    appendFileSync(filePath, JSON.stringify(event) + '\n');
  }

  /**
   * Record a tool call.
   */
  tool(
    taskId: string,
    tool: string,
    status: ToolStatus,
    detail: string = '',
    durationMs?: number,
  ): void {
    const filePath = this.getTracePath(taskId);

    const event: ToolEvent = {
      ts: new Date().toISOString(),
      type: 'tool',
      taskId,
      tool,
      status,
      detail: detail.substring(0, 500),
      ...(durationMs !== undefined && { durationMs }),
    };

    appendFileSync(filePath, JSON.stringify(event) + '\n');
  }

  /**
   * Record an error.
   */
  error(taskId: string, tool: string, error: string): void {
    const filePath = this.getTracePath(taskId);

    const event: ErrorEvent = {
      ts: new Date().toISOString(),
      type: 'error',
      taskId,
      tool,
      error: error.substring(0, 500),
    };

    appendFileSync(filePath, JSON.stringify(event) + '\n');
  }

  /**
   * End recording for a task.
   */
  end(taskId: string, outcome: TaskOutcome, summary: string = ''): EndEvent {
    const filePath = this.getTracePath(taskId);
    const events = this.loadTrace(taskId);

    const startEvent = events.find((e) => e.type === 'start') as
      | StartEvent
      | undefined;
    const startTs = startEvent?.ts || new Date().toISOString();
    const endTs = new Date().toISOString();
    const durationMs =
      new Date(endTs).getTime() - new Date(startTs).getTime();

    const toolEvents = events.filter((e) => e.type === 'tool') as ToolEvent[];
    const errorEvents = events.filter((e) => e.type === 'error');

    const endEvent: EndEvent = {
      ts: endTs,
      type: 'end',
      taskId,
      outcome,
      summary: summary.substring(0, 1000),
      startTs,
      durationMs,
      totalTools: toolEvents.length,
      ok: toolEvents.filter((e) => e.status === 'ok').length,
      errors: toolEvents.filter((e) => e.status === 'error').length,
      retries: toolEvents.filter((e) => e.status === 'retry').length,
      errorEvents: errorEvents.length,
    };

    appendFileSync(filePath, JSON.stringify(endEvent) + '\n');
    this.activeTraces.delete(taskId);

    return endEvent;
  }

  /**
   * Load a complete trace.
   */
  loadTrace(taskId: string): TraceEvent[] {
    const filePath = this.getTracePath(taskId);
    if (!existsSync(filePath)) return [];

    return readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TraceEvent);
  }

  /**
   * Summarise a completed trace.
   */
  summarise(taskId: string): TraceSummary | null {
    const events = this.loadTrace(taskId);
    if (events.length === 0) return null;

    const startEvent = events.find((e) => e.type === 'start') as
      | StartEvent
      | undefined;
    const endEvent = events.find((e) => e.type === 'end') as
      | EndEvent
      | undefined;

    if (!startEvent || !endEvent) return null;

    const toolEvents = events.filter((e) => e.type === 'tool') as ToolEvent[];
    const errorEvents = events.filter((e) => e.type === 'error') as ErrorEvent[];

    // Per-tool stats
    const toolMap = new Map<string, ToolStats>();
    for (const te of toolEvents) {
      const existing = toolMap.get(te.tool) || {
        tool: te.tool,
        total: 0,
        ok: 0,
        errors: 0,
        retries: 0,
        timeouts: 0,
        successRate: 0,
      };
      existing.total++;
      if (te.status === 'ok') existing.ok++;
      if (te.status === 'error') existing.errors++;
      if (te.status === 'retry') existing.retries++;
      if (te.status === 'timeout') existing.timeouts++;
      existing.successRate =
        existing.total > 0 ? existing.ok / existing.total : 0;
      toolMap.set(te.tool, existing);
    }

    return {
      taskId,
      description: startEvent.description,
      agent: startEvent.agent,
      outcome: endEvent.outcome,
      startTs: startEvent.ts,
      endTs: endEvent.ts,
      durationMs: endEvent.durationMs,
      totalTools: endEvent.totalTools,
      ok: endEvent.ok,
      errors: endEvent.errors,
      retries: endEvent.retries,
      toolStats: Array.from(toolMap.values()),
      errorMessages: errorEvents.map((e) => e.error),
      events,
    };
  }

  /**
   * List all completed traces (those with an end event).
   */
  listCompleted(): string[] {
    if (!existsSync(this.traceDir)) return [];

    return readdirSync(this.traceDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => basename(f, '.jsonl'))
      .filter((taskId) => {
        const events = this.loadTrace(taskId);
        return events.some((e) => e.type === 'end');
      });
  }

  /**
   * List unanalysed traces (completed but no .analysed marker).
   */
  listUnanalysed(): string[] {
    return this.listCompleted().filter((taskId) => {
      const markerPath = resolve(this.traceDir, `${taskId}.jsonl.analysed`);
      return !existsSync(markerPath);
    });
  }

  /**
   * Mark a trace as analysed.
   */
  markAnalysed(taskId: string): void {
    const markerPath = resolve(this.traceDir, `${taskId}.jsonl.analysed`);
    writeFileSync(markerPath, new Date().toISOString());
  }

  /**
   * Check if a task is currently being recorded.
   */
  isRecording(taskId: string): boolean {
    return this.activeTraces.has(taskId);
  }

  private getTracePath(taskId: string): string {
    const active = this.activeTraces.get(taskId);
    if (active) return active;

    const filePath = resolve(this.traceDir, `${taskId}.jsonl`);
    return filePath;
  }
}
