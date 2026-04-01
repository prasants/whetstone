/**
 * ExecutionAnalyser — Post-task analysis and tool quality tracking.
 *
 * Takes a completed trace, extracts signals (degradation, failures,
 * retry patterns), tracks per-tool reliability, and stores findings
 * in the Whetstone signal pipeline.
 *
 * Inspired by OpenSpace's ExecutionAnalyzer.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import {
  TraceRecorder,
  TraceSummary,
  ToolStats,
  TaskOutcome,
} from './recorder.js';
import { Signal, SignalType, SignalCategory, Confidence } from './types.js';

// ── Types ───────────────────────────────────────────────────────

export interface AnalysisResult {
  taskId: string;
  signals: Signal[];
  toolDegradations: ToolDegradation[];
  summary: string;
  analysedAt: string;
}

export interface ToolDegradation {
  tool: string;
  successRate: number;
  totalCalls: number;
  errors: number;
  lastError: string;
  severity: 'warning' | 'critical';
}

export interface AggregateToolStats {
  tool: string;
  totalCalls: number;
  totalOk: number;
  totalErrors: number;
  totalRetries: number;
  totalTimeouts: number;
  successRate: number;
  taskCount: number;
  recentFailureRate: number; // last 5 tasks
}

// ── Thresholds ──────────────────────────────────────────────────

const DEGRADATION_THRESHOLD = 0.5; // success rate below 50% = degradation
const CRITICAL_SUCCESS_FLOOR = 0.2; // success rate below 20% (80% error rate) = critical
const EXCESSIVE_RETRIES = 2; // >2 retries in one task = signal

// ── Analyser ────────────────────────────────────────────────────

export class ExecutionAnalyser {
  private recorder: TraceRecorder;
  private statsPath: string;

  constructor(workspace: string, recorder: TraceRecorder) {
    this.recorder = recorder;
    this.statsPath = resolve(workspace, '.whetstone', 'tool-stats.jsonl');
    mkdirSync(resolve(workspace, '.whetstone'), { recursive: true });
  }

  /**
   * Analyse a completed task trace and return extracted signals.
   */
  analyse(taskId: string): AnalysisResult | null {
    const summary = this.recorder.summarise(taskId);
    if (!summary) return null;

    const signals: Signal[] = [];
    const degradations: ToolDegradation[] = [];

    // 1. Check per-tool reliability
    for (const toolStat of summary.toolStats) {
      this.recordToolStats(taskId, toolStat);

      if (toolStat.total > 0 && toolStat.successRate < DEGRADATION_THRESHOLD) {
        const severity =
          toolStat.successRate < CRITICAL_SUCCESS_FLOOR ? 'critical' : 'warning';
        const lastError =
          summary.errorMessages.find((e) =>
            e.toLowerCase().includes(toolStat.tool.toLowerCase()),
          ) || 'Unknown error';

        degradations.push({
          tool: toolStat.tool,
          successRate: toolStat.successRate,
          totalCalls: toolStat.total,
          errors: toolStat.errors,
          lastError,
          severity,
        });

        signals.push({
          type: 'failure',
          what: `Tool ${toolStat.tool} degraded: ${toolStat.errors}/${toolStat.total} calls failed (${Math.round(toolStat.successRate * 100)}% success)`,
          rootCause: lastError,
          suggestedRule: `Check ${toolStat.tool} availability before use. Have a fallback path.`,
          confidence: severity === 'critical' ? 'high' : 'medium',
          category: 'tool_use',
          context: `Task: ${summary.description}`,
          sessionDate: new Date().toISOString().split('T')[0],
          toolsInvolved: [toolStat.tool],
          filesInvolved: [],
        });
      }
    }

    // 2. Check for excessive retries
    const retryTools = summary.toolStats.filter((t) => t.retries > EXCESSIVE_RETRIES);
    if (retryTools.length > 0) {
      const retryList = retryTools
        .map((t) => `${t.tool}(${t.retries}x)`)
        .join(', ');

      signals.push({
        type: 'failure',
        what: `Excessive retries: ${retryList} in task ${taskId}`,
        rootCause: 'Agent retrying same approach instead of changing strategy',
        suggestedRule:
          'After 2 retries of the same tool call, change approach instead of retrying',
        confidence: 'medium',
        category: 'judgment',
        context: `Task: ${summary.description}`,
        sessionDate: new Date().toISOString().split('T')[0],
        toolsInvolved: retryTools.map((t) => t.tool),
        filesInvolved: [],
      });
    }

    // 3. Task-level failure signal
    if (
      summary.outcome === 'failure' ||
      summary.outcome === 'abandoned'
    ) {
      const lastErrors = summary.errorMessages.slice(-3).join('; ');

      signals.push({
        type: 'failure',
        what: `Task ${taskId} (${summary.description}) ended with outcome: ${summary.outcome}`,
        rootCause: lastErrors || 'Unknown',
        suggestedRule:
          'Investigate root cause and add pre-flight check or fallback',
        confidence: 'medium',
        category: 'judgment',
        context: `Duration: ${Math.round(summary.durationMs / 1000)}s, Tools: ${summary.totalTools}`,
        sessionDate: new Date().toISOString().split('T')[0],
        toolsInvolved: summary.toolStats.map((t) => t.tool),
        filesInvolved: [],
      });
    }

    // Mark as analysed
    this.recorder.markAnalysed(taskId);

    return {
      taskId,
      signals,
      toolDegradations: degradations,
      summary: `${summary.outcome}: ${summary.totalTools} tools (${summary.ok} ok, ${summary.errors} err, ${summary.retries} retry)`,
      analysedAt: new Date().toISOString(),
    };
  }

  /**
   * Analyse all unanalysed traces.
   */
  analysePending(): AnalysisResult[] {
    const unanalysed = this.recorder.listUnanalysed();
    const results: AnalysisResult[] = [];

    for (const taskId of unanalysed) {
      const result = this.analyse(taskId);
      if (result) results.push(result);
    }

    return results;
  }

  /**
   * Get aggregate tool reliability stats.
   */
  getToolStats(): AggregateToolStats[] {
    if (!existsSync(this.statsPath)) return [];

    const lines = readFileSync(this.statsPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);

    const toolMap = new Map<
      string,
      {
        total: number;
        ok: number;
        errors: number;
        retries: number;
        timeouts: number;
        tasks: Set<string>;
        recentTasks: Array<{ taskId: string; ok: number; total: number }>;
      }
    >();

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as {
          tool: string;
          taskId: string;
          total: number;
          ok: number;
          error: number;
          retry: number;
          timeout?: number;
        };

        const existing = toolMap.get(entry.tool) || {
          total: 0,
          ok: 0,
          errors: 0,
          retries: 0,
          timeouts: 0,
          tasks: new Set<string>(),
          recentTasks: [],
        };

        existing.total += entry.total;
        existing.ok += entry.ok;
        existing.errors += entry.error;
        existing.retries += entry.retry;
        existing.timeouts += entry.timeout || 0;
        existing.tasks.add(entry.taskId);
        existing.recentTasks.push({
          taskId: entry.taskId,
          ok: entry.ok,
          total: entry.total,
        });

        toolMap.set(entry.tool, existing);
      } catch {
        // Skip malformed lines
      }
    }

    return Array.from(toolMap.entries()).map(([tool, stats]) => {
      // Recent failure rate: last 5 tasks
      const recent = stats.recentTasks.slice(-5);
      const recentTotal = recent.reduce((sum, t) => sum + t.total, 0);
      const recentOk = recent.reduce((sum, t) => sum + t.ok, 0);

      return {
        tool,
        totalCalls: stats.total,
        totalOk: stats.ok,
        totalErrors: stats.errors,
        totalRetries: stats.retries,
        totalTimeouts: stats.timeouts,
        successRate: stats.total > 0 ? stats.ok / stats.total : 0,
        taskCount: stats.tasks.size,
        recentFailureRate:
          recentTotal > 0 ? 1 - recentOk / recentTotal : 0,
      };
    });
  }

  /**
   * Get tools that are currently degraded.
   */
  getDegradedTools(): AggregateToolStats[] {
    return this.getToolStats().filter(
      (t) => t.successRate < DEGRADATION_THRESHOLD && t.totalCalls >= 2,
    );
  }

  /**
   * Record per-tool stats from a single task.
   */
  private recordToolStats(taskId: string, stats: ToolStats): void {
    const entry = {
      ts: new Date().toISOString(),
      taskId,
      tool: stats.tool,
      total: stats.total,
      ok: stats.ok,
      error: stats.errors,
      retry: stats.retries,
      timeout: stats.timeouts,
    };

    appendFileSync(this.statsPath, JSON.stringify(entry) + '\n');
  }
}
