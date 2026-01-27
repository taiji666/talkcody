// src/services/agents/ralph-loop-service.ts

import { logger } from '@/lib/logger';
import { generateId } from '@/lib/utils';
import { messageService } from '@/services/message-service';
import { taskFileService } from '@/services/task-file-service';
import { useFileChangesStore } from '@/stores/file-changes-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import type { AgentToolSet, MessageAttachment, UIMessage } from '@/types/agent';
import type { RalphLoopConfig, RalphLoopStateFile, RalphLoopStopReason } from '@/types/ralph-loop';
import type { TaskSettings } from '@/types/task';
import type { LLMService } from './llm-service';

const DEFAULT_CONFIG: RalphLoopConfig = {
  enabled: true,
  maxIterations: 6,
  maxWallTimeMs: 60 * 60 * 1000,
  stopCriteria: {
    requirePassingTests: false,
    requireLint: false,
    requireTsc: false,
    requireNoErrors: true,
    successRegex: '<ralph>COMPLETE</ralph>',
    blockedRegex: '<ralph>BLOCKED:(.*?)</ralph>',
  },
  memory: {
    summaryFileName: 'ralph-summary.md',
    feedbackFileName: 'ralph-feedback.md',
    stateFileName: 'ralph-iteration.json',
  },
  context: {
    includeLastNMessages: 0,
  },
};

const COMPLETION_PROMISE = [
  'Ralph Loop completion promise:',
  '- When the task is fully done, output exactly: <ralph>COMPLETE</ralph>',
  '- If blocked, output exactly: <ralph>BLOCKED: reason</ralph>',
].join('\n');

type BashToolResult = {
  success?: boolean;
  command?: string;
  message?: string;
  output?: string;
  error?: string;
};

type IterationToolSummary = {
  toolName: string;
  command?: string;
  success?: boolean;
  output?: string;
  error?: string;
};

type IterationRunResult = {
  fullText: string;
  errors: string[];
  toolSummaries: IterationToolSummary[];
};

export interface RalphLoopRunOptions {
  taskId: string;
  messages: UIMessage[];
  model: string;
  systemPrompt?: string;
  tools?: AgentToolSet;
  agentId?: string;
  userMessage?: string;
  llmService: LLMService;
  abortController: AbortController;
  onStatus?: (status: string) => void;
  onAttachment?: (attachment: MessageAttachment) => void;
}

export interface RalphLoopRunResult {
  success: boolean;
  fullText: string;
  stopReason: RalphLoopStopReason;
  stopMessage?: string;
  iterations: number;
}

function parseTaskSettings(taskId: string): TaskSettings | null {
  const task = useTaskStore.getState().getTask(taskId);
  if (!task?.settings) return null;
  try {
    return JSON.parse(task.settings) as TaskSettings;
  } catch (error) {
    logger.warn('[RalphLoop] Failed to parse task settings', { taskId, error });
    return null;
  }
}

function isRalphLoopEnabled(taskId: string): boolean {
  const globalEnabled = useSettingsStore.getState().getRalphLoopEnabled();
  const settings = parseTaskSettings(taskId);
  if (typeof settings?.ralphLoopEnabled === 'boolean') {
    return settings.ralphLoopEnabled;
  }
  return globalEnabled;
}

function buildStopRegex(pattern?: string): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, 'i');
  } catch (error) {
    logger.warn('[RalphLoop] Invalid stop regex, ignoring', { pattern, error });
    return null;
  }
}

function coerceUserContent(content: UIMessage['content']): string {
  if (typeof content === 'string') return content;
  try {
    return JSON.stringify(content);
  } catch {
    return '';
  }
}

function isBashResult(value: unknown): value is BashToolResult {
  if (!value || typeof value !== 'object') return false;
  return 'success' in value || 'command' in value || 'error' in value;
}

function matchCommand(command: string | undefined, patterns: RegExp[]): boolean {
  if (!command) return false;
  return patterns.some((pattern) => pattern.test(command.trim()));
}

const TEST_COMMAND_PATTERNS = [
  /^bun\s+run\s+test(\b|:)/,
  /^npm\s+(run\s+)?test(\b|:)/,
  /^yarn\s+test(\b|:)/,
  /^pnpm\s+test(\b|:)/,
  /^vitest(\b|\s)/,
  /^jest(\b|\s)/,
  /^pytest(\b|\s)/,
  /^cargo\s+test(\b|\s)/,
  /^go\s+test(\b|\s)/,
];

const LINT_COMMAND_PATTERNS = [
  /^bun\s+run\s+lint(\b|:)/,
  /^npm\s+(run\s+)?lint(\b|:)/,
  /^yarn\s+lint(\b|:)/,
  /^pnpm\s+lint(\b|:)/,
  /^eslint(\b|\s)/,
  /^biome(\b|\s)/,
  /^ruff(\b|\s)/,
];

const TSC_COMMAND_PATTERNS = [/^bun\s+run\s+tsc(\b|:)/, /^tsc(\b|\s)/];

export class RalphLoopService {
  async runLoop(options: RalphLoopRunOptions): Promise<RalphLoopRunResult> {
    const {
      taskId,
      messages,
      model,
      systemPrompt,
      tools = {},
      agentId,
      userMessage,
      llmService,
      abortController,
      onStatus,
      onAttachment,
    } = options;

    if (!isRalphLoopEnabled(taskId)) {
      throw new Error('Ralph Loop is not enabled for this task');
    }

    const startTime = Date.now();
    const config = { ...DEFAULT_CONFIG };

    let iterations = 0;
    let finalText = '';
    let stopReason: RalphLoopStopReason = 'unknown';
    let stopMessage: string | undefined;

    const summaryFile = config.memory.summaryFileName;
    const feedbackFile = config.memory.feedbackFileName;
    const stateFile = config.memory.stateFileName;

    const successRegex = buildStopRegex(config.stopCriteria.successRegex);
    const blockedRegex = buildStopRegex(config.stopCriteria.blockedRegex);

    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    const baseUserMessage = userMessage || coerceUserContent(lastUserMessage?.content ?? '');

    if (!baseUserMessage) {
      throw new Error('Ralph Loop requires a user task to run');
    }

    const attachments = lastUserMessage?.attachments || [];

    while (iterations < config.maxIterations) {
      if (abortController.signal.aborted) {
        stopReason = 'error';
        stopMessage = 'Aborted by user';
        break;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed > config.maxWallTimeMs) {
        stopReason = 'max-wall-time';
        stopMessage = 'Reached max wall time';
        break;
      }

      iterations += 1;
      onStatus?.(`Ralph Loop: iteration ${iterations}/${config.maxIterations}`);

      const iterationMessages = await this.buildIterationMessages({
        taskId,
        messages,
        userMessage: baseUserMessage,
        attachments,
        summaryFile,
        feedbackFile,
        includeLastN: config.context.includeLastNMessages,
      });

      if (abortController.signal.aborted) {
        stopReason = 'error';
        stopMessage = 'Aborted by user';
        break;
      }

      let iterationResult: IterationRunResult;
      try {
        iterationResult = await this.runIteration({
          taskId,
          messages: iterationMessages,
          model,
          systemPrompt: this.buildSystemPrompt(systemPrompt, config),
          tools,
          agentId,
          llmService,
          abortController,
          onStatus,
          onAttachment,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        iterationResult = { fullText: finalText, errors: [message], toolSummaries: [] };
        stopReason = 'error';
        stopMessage = message;
      }

      if (stopReason === 'error') {
        await this.persistIterationArtifacts({
          taskId,
          iteration: iterations,
          startTime,
          userMessage: baseUserMessage,
          summaryFile,
          feedbackFile,
          stateFile,
          iterationResult,
          evaluation: {
            stopReason,
            stopMessage,
            completionPromiseMatched: false,
            errors: iterationResult.errors,
          },
        });
        break;
      }

      finalText = iterationResult.fullText;

      const evaluation = this.evaluateStopCriteria({
        fullText: finalText,
        errors: iterationResult.errors,
        toolSummaries: iterationResult.toolSummaries,
        successRegex,
        blockedRegex,
        stopCriteria: config.stopCriteria,
      });

      await this.persistIterationArtifacts({
        taskId,
        iteration: iterations,
        startTime,
        userMessage: baseUserMessage,
        summaryFile,
        feedbackFile,
        stateFile,
        iterationResult,
        evaluation,
      });

      if (evaluation.shouldStop) {
        stopReason = evaluation.stopReason;
        stopMessage = evaluation.stopMessage;
        break;
      }
    }

    if (stopReason === 'unknown' && iterations >= config.maxIterations) {
      stopReason = 'max-iterations';
      stopMessage = 'Reached max iterations';
    }

    await this.persistFinalState({
      taskId,
      iteration: iterations,
      startTime,
      summaryFile,
      stateFile,
      stopReason,
      stopMessage,
    });

    return {
      success: stopReason === 'complete',
      fullText: finalText,
      stopReason,
      stopMessage,
      iterations,
    };
  }

  private buildSystemPrompt(systemPrompt: string | undefined, config: RalphLoopConfig): string {
    const stopRules: string[] = [];

    if (config.stopCriteria.requirePassingTests) {
      stopRules.push('- Run tests and ensure they pass before completion.');
    }
    if (config.stopCriteria.requireLint) {
      stopRules.push('- Run lint and fix all lint errors before completion.');
    }
    if (config.stopCriteria.requireTsc) {
      stopRules.push('- Run typecheck (tsc) and fix all errors before completion.');
    }
    if (config.stopCriteria.requireNoErrors) {
      stopRules.push('- Do not declare completion if any tool or execution errors occurred.');
    }

    const stopRulesText = stopRules.length
      ? ['Stop criteria:', ...stopRules].join('\n')
      : 'Stop criteria: No additional automated checks required.';

    return [systemPrompt, 'Ralph Loop mode is enabled.', COMPLETION_PROMISE, stopRulesText]
      .filter(Boolean)
      .join('\n\n');
  }

  private async buildIterationMessages(params: {
    taskId: string;
    messages: UIMessage[];
    userMessage: string;
    attachments: MessageAttachment[];
    summaryFile: string;
    feedbackFile: string;
    includeLastN?: number;
  }): Promise<UIMessage[]> {
    const { taskId, messages, userMessage, attachments, summaryFile, feedbackFile, includeLastN } =
      params;

    const summary = await taskFileService.readFile('context', taskId, summaryFile);
    const feedback = await taskFileService.readFile('context', taskId, feedbackFile);

    const recentMessages = includeLastN && includeLastN > 0 ? messages.slice(-includeLastN) : [];

    const promptSections = ['## Task', userMessage];

    if (summary) {
      promptSections.push('## Ralph Summary', summary);
    }

    if (feedback) {
      promptSections.push('## Ralph Feedback', feedback);
    }

    return [
      ...recentMessages,
      {
        id: generateId(),
        role: 'user',
        content: promptSections.join('\n\n'),
        timestamp: new Date(),
        attachments,
      },
    ];
  }

  private async runIteration(params: {
    taskId: string;
    messages: UIMessage[];
    model: string;
    systemPrompt?: string;
    tools: AgentToolSet;
    agentId?: string;
    llmService: LLMService;
    abortController: AbortController;
    onStatus?: (status: string) => void;
    onAttachment?: (attachment: MessageAttachment) => void;
  }): Promise<IterationRunResult> {
    const {
      taskId,
      messages,
      model,
      systemPrompt,
      tools,
      agentId,
      llmService,
      abortController,
      onStatus,
      onAttachment,
    } = params;

    let currentMessageId = '';
    let streamedContent = '';
    let fullText = '';
    const errors: string[] = [];
    const toolSummaries: IterationToolSummary[] = [];

    await llmService.runAgentLoop(
      {
        messages,
        model,
        systemPrompt,
        tools,
        agentId,
        compression: { enabled: false },
        freshContext: true,
      },
      {
        onAssistantMessageStart: () => {
          if (abortController.signal.aborted) return;

          if (currentMessageId && !streamedContent) {
            return;
          }

          if (currentMessageId && streamedContent) {
            messageService
              .finalizeMessage(taskId, currentMessageId, streamedContent)
              .catch((err) => logger.error('[RalphLoop] Failed to finalize message', err));
          }

          streamedContent = '';
          currentMessageId = messageService.createAssistantMessage(taskId, agentId);
        },
        onChunk: (chunk: string) => {
          if (abortController.signal.aborted) return;
          streamedContent += chunk;
          if (currentMessageId) {
            messageService.updateStreamingContent(taskId, currentMessageId, streamedContent);
          }
          fullText += chunk;
        },
        onComplete: async (finalText: string) => {
          if (abortController.signal.aborted) return;

          if (currentMessageId && streamedContent) {
            await messageService.finalizeMessage(taskId, currentMessageId, streamedContent);
            streamedContent = '';
          }

          if (finalText) {
            fullText = finalText;
          }
        },
        onError: (error: Error) => {
          if (abortController.signal.aborted) return;
          errors.push(error.message || 'Unknown error');
        },
        onStatus: (status: string) => {
          if (abortController.signal.aborted) return;
          onStatus?.(status);
        },
        onToolMessage: async (uiMessage: UIMessage) => {
          if (abortController.signal.aborted) return;

          const toolMessage: UIMessage = {
            ...uiMessage,
            assistantId: uiMessage.assistantId || agentId,
          };

          await messageService.addToolMessage(taskId, toolMessage);

          const toolContent = Array.isArray(toolMessage.content) ? toolMessage.content[0] : null;
          if (!toolContent || toolContent.type !== 'tool-result') return;

          const output = toolContent.output;
          if (isBashResult(output)) {
            toolSummaries.push({
              toolName: toolContent.toolName,
              command: output.command,
              success: output.success,
              output: output.output,
              error: output.error,
            });
            if (output.success === false || output.error) {
              errors.push(output.error || 'Bash command failed');
            }
          } else if (output && typeof output === 'object' && 'error' in output) {
            errors.push(String((output as { error?: string }).error || 'Tool error'));
          }
        },
        onAttachment: async (attachment) => {
          if (abortController.signal.aborted) return;
          if (currentMessageId) {
            await messageService.addAttachment(taskId, currentMessageId, attachment);
          }
          onAttachment?.(attachment);
        },
      },
      abortController
    );

    return { fullText, errors, toolSummaries };
  }

  private evaluateStopCriteria(params: {
    fullText: string;
    errors: string[];
    toolSummaries: IterationToolSummary[];
    successRegex: RegExp | null;
    blockedRegex: RegExp | null;
    stopCriteria: RalphLoopConfig['stopCriteria'];
  }): {
    shouldStop: boolean;
    stopReason: RalphLoopStopReason;
    stopMessage?: string;
    completionPromiseMatched: boolean;
    errors: string[];
  } {
    const { fullText, errors, toolSummaries, successRegex, blockedRegex, stopCriteria } = params;
    const blockedMatch = blockedRegex?.exec(fullText || '');
    if (blockedMatch) {
      return {
        shouldStop: true,
        stopReason: 'blocked',
        stopMessage: blockedMatch[1]?.trim() || 'Blocked',
        completionPromiseMatched: false,
        errors,
      };
    }

    const completionPromiseMatched = successRegex ? successRegex.test(fullText || '') : false;

    const commandMatches = (patterns: RegExp[]) =>
      toolSummaries.filter((summary) => summary.command && matchCommand(summary.command, patterns));

    const testResults = commandMatches(TEST_COMMAND_PATTERNS);
    const lintResults = commandMatches(LINT_COMMAND_PATTERNS);
    const tscResults = commandMatches(TSC_COMMAND_PATTERNS);

    const testsPassed = testResults.some((result) => result.success === true);
    const lintPassed = lintResults.some((result) => result.success === true);
    const tscPassed = tscResults.some((result) => result.success === true);

    if (completionPromiseMatched) {
      if (stopCriteria.requireNoErrors && errors.length > 0) {
        return {
          shouldStop: false,
          stopReason: 'unknown',
          completionPromiseMatched,
          errors,
        };
      }
      if (stopCriteria.requirePassingTests && !testsPassed) {
        return {
          shouldStop: false,
          stopReason: 'unknown',
          completionPromiseMatched,
          errors,
        };
      }
      if (stopCriteria.requireLint && !lintPassed) {
        return {
          shouldStop: false,
          stopReason: 'unknown',
          completionPromiseMatched,
          errors,
        };
      }
      if (stopCriteria.requireTsc && !tscPassed) {
        return {
          shouldStop: false,
          stopReason: 'unknown',
          completionPromiseMatched,
          errors,
        };
      }

      return {
        shouldStop: true,
        stopReason: 'complete',
        completionPromiseMatched,
        errors,
      };
    }

    return {
      shouldStop: false,
      stopReason: 'unknown',
      completionPromiseMatched,
      errors,
    };
  }

  private async persistIterationArtifacts(params: {
    taskId: string;
    iteration: number;
    startTime: number;
    userMessage: string;
    summaryFile: string;
    feedbackFile: string;
    stateFile: string;
    iterationResult: IterationRunResult;
    evaluation: {
      stopReason: RalphLoopStopReason;
      stopMessage?: string;
      completionPromiseMatched: boolean;
      errors: string[];
    };
  }): Promise<void> {
    const {
      taskId,
      iteration,
      startTime,
      userMessage,
      summaryFile,
      feedbackFile,
      stateFile,
      iterationResult,
      evaluation,
    } = params;

    const summary = await taskFileService.readFile('context', taskId, summaryFile);
    const feedback = await taskFileService.readFile('context', taskId, feedbackFile);

    const changes = useFileChangesStore.getState().getChanges(taskId);
    const filesChanged = Array.from(new Set(changes.map((change) => change.filePath)));

    // Build new iteration content
    const newIterationContent = [
      '',
      `## Iteration ${iteration}`,
      `Stop candidate: ${evaluation.stopReason}`,
      `Completion marker: ${evaluation.completionPromiseMatched ? 'matched' : 'not found'}`,
      evaluation.stopMessage ? `Stop message: ${evaluation.stopMessage}` : null,
      '',
      '## Files Changed',
      filesChanged.length ? filesChanged.map((file) => `- ${file}`).join('\n') : 'None',
      '',
      '## Tool Results',
      iterationResult.toolSummaries.length
        ? iterationResult.toolSummaries
            .map((tool) => {
              const status = tool.success === false ? 'failed' : 'ok';
              return `- ${tool.toolName}${tool.command ? ` (${tool.command})` : ''}: ${status}`;
            })
            .join('\n')
        : 'None',
      '',
      '## Errors',
      evaluation.errors.length ? evaluation.errors.map((err) => `- ${err}`).join('\n') : 'None',
      '',
      '## Last Output (truncated)',
      this.truncateText(iterationResult.fullText, 1200),
      feedback ? '## Feedback\n' + feedback : null,
    ].filter(Boolean) as string[];

    // Append new iteration content to existing summary or create new summary
    let summaryContent: string;
    if (!summary || summary.trim().length === 0) {
      // Create new summary with objective
      summaryContent = [
        '# Ralph Loop Summary',
        '',
        '## Objective',
        userMessage,
        ...newIterationContent,
      ].join('\n');
    } else {
      // Append to existing summary
      summaryContent = summary.trim() + newIterationContent.join('\n');
    }

    await taskFileService.writeFile('context', taskId, summaryFile, summaryContent);

    const state: RalphLoopStateFile = {
      taskId,
      startedAt: startTime,
      updatedAt: Date.now(),
      iteration,
      stopReason: evaluation.stopReason,
      stopMessage: evaluation.stopMessage,
      completionPromiseMatched: evaluation.completionPromiseMatched,
      errors: evaluation.errors,
    };

    await taskFileService.writeFile('context', taskId, stateFile, JSON.stringify(state, null, 2));
  }

  private async persistFinalState(params: {
    taskId: string;
    iteration: number;
    startTime: number;
    summaryFile: string;
    stateFile: string;
    stopReason: RalphLoopStopReason;
    stopMessage?: string;
  }): Promise<void> {
    const { taskId, iteration, startTime, summaryFile, stateFile, stopReason, stopMessage } =
      params;

    const summary = await taskFileService.readFile('context', taskId, summaryFile);

    const state: RalphLoopStateFile = {
      taskId,
      startedAt: startTime,
      updatedAt: Date.now(),
      iteration,
      stopReason,
      stopMessage,
      completionPromiseMatched: stopReason === 'complete',
      errors: [],
    };

    await taskFileService.writeFile('context', taskId, stateFile, JSON.stringify(state, null, 2));

    if (!summary) {
      await taskFileService.writeFile(
        'context',
        taskId,
        summaryFile,
        `# Ralph Loop Summary\n\nStop reason: ${stopReason}`
      );
    }
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...`;
  }
}

export const ralphLoopService = new RalphLoopService();
