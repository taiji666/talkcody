// src/services/execution-service.ts
/**
 * ExecutionService - LLM execution management
 *
 * This service manages the execution of AI agent loops:
 * - Starts and stops task executions
 * - Manages LLMService instances per task
 * - Coordinates between stores and services
 *
 * Design principles:
 * - Each task gets its own LLMService instance for isolation
 * - Concurrent execution support (up to maxConcurrent tasks)
 * - All callbacks route through MessageService for persistence
 */

import { logger } from '@/lib/logger';
import { createLLMService, type LLMService } from '@/services/agents/llm-service';
import { ralphLoopService } from '@/services/agents/ralph-loop-service';
import { messageService } from '@/services/message-service';
import { notificationService } from '@/services/notification-service';
import { taskService } from '@/services/task-service';
import { useExecutionStore } from '@/stores/execution-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaskStore } from '@/stores/task-store';
import { useWorktreeStore } from '@/stores/worktree-store';
import type { AgentToolSet, UIMessage } from '@/types/agent';

/**
 * Configuration for starting an execution
 */
export interface ExecutionConfig {
  taskId: string;
  messages: UIMessage[];
  model: string;
  systemPrompt?: string;
  tools?: AgentToolSet;
  agentId?: string;
  isNewTask?: boolean;
  userMessage?: string;
}

/**
 * Callbacks for execution events
 */
export interface ExecutionCallbacks {
  onComplete?: (result: { success: boolean; fullText: string }) => void;
  onError?: (error: Error) => void;
}

class ExecutionService {
  private llmServiceInstances = new Map<string, LLMService>();

  /**
   * Start execution for a task
   */
  async startExecution(config: ExecutionConfig, callbacks?: ExecutionCallbacks): Promise<void> {
    const { taskId, messages, model, systemPrompt, tools, agentId } = config;

    const executionStore = useExecutionStore.getState();

    // 1. Check concurrency limit and start execution tracking
    const { success, abortController, error } = executionStore.startExecution(taskId);
    if (!success || !abortController) {
      const execError = new Error(error || 'Failed to start execution');
      callbacks?.onError?.(execError);
      throw execError;
    }

    // 2. Try to acquire worktree for parallel execution (if enabled and needed)
    const runningTaskIds = this.getRunningTaskIds().filter((id) => id !== taskId);
    try {
      const worktreePath = await useWorktreeStore.getState().acquireForTask(taskId, runningTaskIds);
      if (worktreePath) {
        logger.info('[ExecutionService] Task using worktree', { taskId, worktreePath });
      }
    } catch (worktreeError) {
      // Log warning but continue - task will work in main project directory
      logger.warn(
        '[ExecutionService] Worktree acquisition failed, using main project',
        worktreeError
      );
    }

    // 3. Create independent LLMService instance for this task
    const llmService = createLLMService(taskId);
    this.llmServiceInstances.set(taskId, llmService);

    let currentMessageId = '';
    let streamedContent = '';

    try {
      const finalizeExecution = async () => {
        if (currentMessageId && streamedContent) {
          await messageService.finalizeMessage(taskId, currentMessageId, streamedContent);
          streamedContent = '';
        }

        const runningUsage = useTaskStore.getState().runningTaskUsage.get(taskId);
        if (runningUsage) {
          await taskService
            .updateTaskUsage(
              taskId,
              runningUsage.costDelta,
              runningUsage.inputTokensDelta,
              runningUsage.outputTokensDelta,
              runningUsage.requestCountDelta,
              runningUsage.contextUsage
            )
            .then(() => {
              useTaskStore.getState().flushRunningTaskUsage(taskId);
            })
            .finally(() => {
              useTaskStore.getState().clearRunningTaskUsage(taskId);
            });
        }
      };

      const handleCompletion = async (fullText: string, success: boolean = true) => {
        if (abortController.signal.aborted) return;

        await finalizeExecution();

        if (success) {
          await notificationService.notifyHooked(
            taskId,
            'Task Complete',
            'TalkCody agent has finished processing',
            'agent_complete'
          );
        }

        callbacks?.onComplete?.({ success, fullText });
      };

      // Check per-task Ralph Loop setting first, fallback to global setting
      const taskSettings = useTaskStore.getState().getTask(taskId)?.settings;
      let ralphLoopEnabled = false;
      if (taskSettings) {
        try {
          const parsedSettings = JSON.parse(taskSettings) as { ralphLoopEnabled?: boolean };
          ralphLoopEnabled =
            typeof parsedSettings.ralphLoopEnabled === 'boolean'
              ? parsedSettings.ralphLoopEnabled
              : useSettingsStore.getState().getRalphLoopEnabled();
        } catch {
          ralphLoopEnabled = useSettingsStore.getState().getRalphLoopEnabled();
        }
      } else {
        ralphLoopEnabled = useSettingsStore.getState().getRalphLoopEnabled();
      }

      if (ralphLoopEnabled) {
        if (currentMessageId && streamedContent) {
          await messageService.finalizeMessage(taskId, currentMessageId, streamedContent);
          streamedContent = '';
          currentMessageId = '';
        }

        const result = await ralphLoopService.runLoop({
          taskId,
          messages,
          model,
          systemPrompt,
          tools,
          agentId,
          userMessage: config.userMessage,
          llmService,
          abortController,
          onStatus: (status) => {
            if (abortController.signal.aborted) return;
            executionStore.setServerStatus(taskId, status);
          },
          onAttachment: async (attachment) => {
            if (abortController.signal.aborted) return;
            if (currentMessageId) {
              await messageService.addAttachment(taskId, currentMessageId, attachment);
            }
          },
        });

        await handleCompletion(result.fullText, result.success);
      } else {
        // 4. Run agent loop with callbacks that route through services
        await llmService.runAgentLoop(
          {
            messages,
            model,
            systemPrompt,
            tools,
            agentId,
          },
          {
            onAssistantMessageStart: () => {
              if (abortController.signal.aborted) return;

              // Skip if a message was just created but hasn't received content
              if (currentMessageId && !streamedContent) {
                logger.info('[ExecutionService] Skipping duplicate message start', { taskId });
                return;
              }

              // Finalize previous message if any
              if (currentMessageId && streamedContent) {
                messageService
                  .finalizeMessage(taskId, currentMessageId, streamedContent)
                  .catch((err) => logger.error('Failed to finalize previous message:', err));
              }

              // Reset for new message
              streamedContent = '';
              currentMessageId = messageService.createAssistantMessage(taskId, agentId);
            },

            onChunk: (chunk: string) => {
              if (abortController.signal.aborted) return;
              streamedContent += chunk;
              if (currentMessageId) {
                messageService.updateStreamingContent(taskId, currentMessageId, streamedContent);
              }
            },

            onComplete: async (fullText: string) => {
              if (abortController.signal.aborted) return;

              await handleCompletion(fullText);
            },

            onError: (error: Error) => {
              if (abortController.signal.aborted) return;

              logger.error('[ExecutionService] Agent loop error', error);
              executionStore.setError(taskId, error.message);

              // Clear running usage on error to avoid stale data
              useTaskStore.getState().clearRunningTaskUsage(taskId);

              callbacks?.onError?.(error);
            },

            onStatus: (status: string) => {
              if (abortController.signal.aborted) return;
              executionStore.setServerStatus(taskId, status);
            },

            onToolMessage: async (uiMessage: UIMessage) => {
              if (abortController.signal.aborted) return;

              const toolMessage: UIMessage = {
                ...uiMessage,
                assistantId: uiMessage.assistantId || agentId,
              };

              await messageService.addToolMessage(taskId, toolMessage);
            },

            onAttachment: async (attachment) => {
              if (abortController.signal.aborted) return;
              if (currentMessageId) {
                await messageService.addAttachment(taskId, currentMessageId, attachment);
              }
            },
          },
          abortController
        );
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        const execError = error instanceof Error ? error : new Error(String(error));
        executionStore.setError(taskId, execError.message);
        callbacks?.onError?.(execError);
      }
    } finally {
      this.llmServiceInstances.delete(taskId);

      // Ensure execution is marked as completed/stopped
      if (executionStore.isRunning(taskId)) {
        executionStore.completeExecution(taskId);
      }
    }
  }

  /**
   * Stop execution for a task
   */
  stopExecution(taskId: string): void {
    const executionStore = useExecutionStore.getState();
    executionStore.stopExecution(taskId);
    this.llmServiceInstances.delete(taskId);

    // Stop streaming in task store
    useTaskStore.getState().stopStreaming(taskId);

    logger.info('[ExecutionService] Execution stopped', { taskId });
  }

  /**
   * Check if a task is running
   */
  isRunning(taskId: string): boolean {
    return useExecutionStore.getState().isRunning(taskId);
  }

  /**
   * Get running task IDs
   */
  getRunningTaskIds(): string[] {
    return useExecutionStore.getState().getRunningTaskIds();
  }

  /**
   * Check if a new execution can be started
   */
  canStartNew(): boolean {
    return useExecutionStore.getState().canStartNew();
  }
}

export const executionService = new ExecutionService();
