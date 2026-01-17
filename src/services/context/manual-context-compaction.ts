// src/services/context/manual-context-compaction.ts
import type { ModelMessage } from 'ai';
import { convertMessages } from '@/lib/llm-utils';
import { logger } from '@/lib/logger';
import { convertToAnthropicFormat } from '@/lib/message-convert';
import { generateId } from '@/lib/utils';
import { modelTypeService } from '@/providers/models/model-type-service';
import { taskFileService } from '@/services/task-file-service';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import { useTaskStore } from '@/stores/task-store';
import type { CompressionConfig, UIMessage } from '@/types/agent';
import { ModelType } from '@/types/model-types';
import { ContextCompactor } from './context-compactor';

export interface ManualCompactionResult {
  success: boolean;
  message: string;
  error?: string;
  compressedMessages?: UIMessage[];
  compressionRatio?: number;
}

interface BuildCompactionConfigInput {
  config?: Partial<CompressionConfig>;
}

const DEFAULT_COMPRESSION_CONFIG: Omit<CompressionConfig, 'compressionModel'> = {
  enabled: true,
  preserveRecentMessages: 6,
  compressionThreshold: 0.8,
};

function buildCompressionConfig({ config }: BuildCompactionConfigInput): CompressionConfig {
  return {
    ...DEFAULT_COMPRESSION_CONFIG,
    ...config,
    compressionModel: modelTypeService.resolveModelTypeSync(ModelType.MESSAGE_COMPACTION),
  };
}

function hasSystemMessage(messages: UIMessage[]): boolean {
  return messages.some((msg) => msg.role === 'system');
}

function mapModelMessageToUI(
  message: ModelMessage,
  originalMessages: UIMessage[],
  fallbackId: string
): UIMessage {
  if (message.role === 'system') {
    return {
      id: fallbackId,
      role: 'system',
      content:
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
      timestamp: new Date(),
    };
  }

  if (message.role === 'assistant' && Array.isArray(message.content)) {
    const content = message.content.map((part) => {
      if (part.type === 'tool-call') {
        return {
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
        };
      }
      return {
        type: 'text',
        text: (part as any).text || '',
      };
    });

    return {
      id: fallbackId,
      role: 'assistant',
      content,
      timestamp: new Date(),
    } as UIMessage;
  }

  if (message.role === 'assistant' || message.role === 'user') {
    const originalMatch = originalMessages.find(
      (msg) => msg.role === message.role && typeof msg.content === typeof message.content
    );
    return {
      id: originalMatch?.id || fallbackId,
      role: message.role,
      content: typeof message.content === 'string' ? message.content : '',
      timestamp: new Date(),
      assistantId: originalMatch?.assistantId,
      attachments: originalMatch?.attachments,
    } as UIMessage;
  }

  if (message.role === 'tool' && Array.isArray(message.content)) {
    const content = message.content.map((part) => ({
      type: 'tool-result',
      toolCallId: (part as any).toolCallId,
      toolName: (part as any).toolName,
      output: (part as any).output,
    }));

    return {
      id: fallbackId,
      role: 'tool',
      content,
      timestamp: new Date(),
      toolCallId: content[0]?.toolCallId,
      toolName: content[0]?.toolName,
    } as UIMessage;
  }

  return {
    id: fallbackId,
    role: 'user',
    content: '',
    timestamp: new Date(),
  };
}

function mapModelMessagesToUI(
  messages: ModelMessage[],
  originalMessages: UIMessage[]
): UIMessage[] {
  return messages.map((message, index) =>
    mapModelMessageToUI(message, originalMessages, `compact-${generateId()}-${index}`)
  );
}

export async function compactTaskContext(taskId: string): Promise<ManualCompactionResult> {
  if (!taskId) {
    return {
      success: false,
      message: 'No active task - cannot compact context',
      error: 'No active task - cannot compact context',
    };
  }

  try {
    const taskStore = useTaskStore.getState();
    const task = taskStore.getTask(taskId);

    if (!task) {
      return {
        success: false,
        message: 'Task not found',
        error: 'Task not found',
      };
    }

    const messages = taskStore.getMessages(taskId);
    if (messages.length === 0) {
      return {
        success: false,
        message: 'No messages to compact',
      };
    }

    const rootPath = await getEffectiveWorkspaceRoot(taskId);
    const model = task.model ?? '';
    const systemPrompt =
      messages[0]?.role === 'system' && typeof messages[0].content === 'string'
        ? messages[0].content
        : '';

    const modelMessages = await convertMessages(messages, {
      rootPath,
      systemPrompt: hasSystemMessage(messages) ? undefined : systemPrompt,
      model,
    });

    const validation = convertToAnthropicFormat(modelMessages, {
      autoFix: true,
      trimAssistantWhitespace: true,
    });

    const compactor = new ContextCompactor();
    const compressionConfig = buildCompressionConfig({});

    const compressionResult = await compactor.compactMessages(
      {
        messages: validation,
        config: compressionConfig,
        systemPrompt,
      },
      0
    );

    if (!compressionResult.compressedSummary && compressionResult.sections.length === 0) {
      return {
        success: false,
        message: 'No compression needed - context is already compact',
      };
    }

    const compressedMessages = compactor.createCompressedMessages(compressionResult);
    const uiMessages = mapModelMessagesToUI(compressedMessages, messages);

    // Save compacted messages to file instead of updating store
    const data = {
      messages: compressedMessages,
      sourceUIMessageCount: messages.length,
      lastRequestTokens: 0,
      updatedAt: Date.now(),
    };
    await taskFileService.writeFile(
      'context',
      taskId,
      'compacted-messages.json',
      JSON.stringify(data)
    );

    const reduction = ((1 - compressionResult.compressionRatio) * 100).toFixed(1);
    const resultMessage = `Context compacted successfully. Reduced to ${compressionResult.compressedMessageCount} messages (${reduction}% reduction)`;

    return {
      success: true,
      message: resultMessage,
      compressedMessages: uiMessages,
      compressionRatio: compressionResult.compressionRatio,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[manual-compaction] Failed to compact context:', error);
    return {
      success: false,
      message: `Failed to compact context: ${errorMessage}`,
      error: `Failed to compact context: ${errorMessage}`,
    };
  }
}
