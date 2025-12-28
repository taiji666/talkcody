import { Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import { useState } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getRelativePath } from '@/services/repository-utils';
import { useFileChangesStore } from '@/stores/file-changes-store';
import { useRepositoryStore } from '@/stores/repository-store';
import { EditFileResult } from './edit-file-result';
import { WriteFileResult } from './write-file-result';

interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface UnifiedToolResultProps {
  toolName: string;
  input: Record<string, unknown>;
  output?: unknown;
  isError?: boolean;
  children: React.ReactNode;
  taskId?: string;
  toolCallId?: string;
}

/**
 * Format tool input for display summary
 * Exported for use in persisting tool messages
 */
export function formatToolInputSummary(
  toolName: string,
  input: Record<string, unknown>,
  options?: {
    rootPath?: string;
    output?: unknown;
  }
): string {
  if (!input) return '';
  const { rootPath, output } = options || {};

  if (toolName === 'codeSearch') {
    return `${input.pattern} in ${input.path}`;
  }
  if (toolName === 'exitPlanMode') {
    return (output as { action?: string })?.action ?? '';
  }
  if (toolName === 'listFiles') {
    return `${input.directory_path}`;
  }
  if (toolName === 'todoWrite' && Array.isArray(input.todos)) {
    const inProgressTodo = (input.todos as TodoItem[]).find(
      (todo) => todo.status === 'in_progress'
    );
    if (inProgressTodo?.content) {
      return `"${inProgressTodo.content}" doing`;
    }
    return `Updating ${input.todos.length} todo(s)`;
  }

  if (input.file_path && typeof input.file_path === 'string') {
    // For file tools, convert absolute paths to relative paths
    if (
      rootPath &&
      (toolName === 'readFile' || toolName === 'writeFile' || toolName === 'editFile')
    ) {
      return getRelativePath(input.file_path, rootPath);
    }
    return input.file_path;
  }
  if (input.query && typeof input.query === 'string') return input.query;
  if (input.command && typeof input.command === 'string') {
    // For bash tool, remove the leading "cd /path/to/workspace && " prefix
    if (toolName === 'bashTool') {
      const command = input.command as string;
      const match = command.match(/^cd\s+[^\s]+\s+&&\s+(.+)$/);
      return match?.[1] ?? command;
    }
    return input.command;
  }
  if (input.url && typeof input.url === 'string') return input.url;
  if (input.agentId && typeof input.agentId === 'string') return input.agentId;

  // Fallback: join values or JSON
  const values = Object.values(input).filter((v) => typeof v === 'string' || typeof v === 'number');
  if (values.length > 0 && values.length <= 2) {
    return values.join(' ');
  }

  try {
    return JSON.stringify(input);
  } catch {
    return 'Complex Input';
  }
}

export function UnifiedToolResult({
  toolName,
  input,
  output,
  isError: explicitError,
  children,
  taskId,
  toolCallId,
}: UnifiedToolResultProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootPath = useRepositoryStore((state) => state.rootPath);

  // Determine if error based on explicit prop or output content
  const isError = (() => {
    if (explicitError !== undefined) {
      return explicitError;
    }
    if (!output || typeof output !== 'object') {
      return false;
    }

    const outputObj = output as Record<string, unknown>;

    // For bash tool: use 'success' field (error field contains stderr, not an error indicator)
    if ('success' in outputObj && typeof outputObj.success === 'boolean') {
      return !outputObj.success;
    }

    // For other tools: check for error indicators
    if ('status' in outputObj && outputObj.status === 'error') {
      return true;
    }
    if ('error' in outputObj && !!outputObj.error) {
      return true;
    }

    return false;
  })();

  // Render specialized content for writeFile and editFile tools
  const renderSpecializedContent = () => {
    // For writeFile: get content from input
    if (toolName === 'writeFile' && input.file_path && input.content) {
      return (
        <WriteFileResult filePath={input.file_path as string} content={input.content as string} />
      );
    }

    // For editFile: get diff from file-changes-store
    if (toolName === 'editFile' && input.file_path && taskId) {
      const changes = useFileChangesStore.getState().getChanges(taskId);
      const fileChange = toolCallId
        ? changes.find((c) => c.toolId === toolCallId)
        : changes.find((c) => c.filePath === input.file_path);

      if (fileChange?.originalContent && fileChange?.newContent) {
        return (
          <EditFileResult
            filePath={input.file_path as string}
            originalContent={fileChange.originalContent}
            newContent={fileChange.newContent}
          />
        );
      }
    }

    return null;
  };

  const specializedContent = renderSpecializedContent();

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="w-full border rounded-md bg-card text-card-foreground shadow-sm mb-1"
    >
      <CollapsibleTrigger className="flex items-center w-full p-1 hover:bg-muted/50 transition-colors text-left">
        <div className="mr-2 flex-shrink-0">
          {isError ? (
            <X className="h-4 w-4 text-red-500" />
          ) : (
            <Check className="h-4 w-4 text-green-500" />
          )}
        </div>
        <div className="font-medium mr-2 flex-shrink-0">{toolName}</div>
        <div className="text-muted-foreground flex-1 font-mono text-xs break-all overflow-hidden line-clamp-2">
          {formatToolInputSummary(toolName, input, { rootPath: rootPath ?? undefined, output })}
        </div>
        <div className="ml-2 flex-shrink-0">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t bg-muted/20 p-2 overflow-x-auto">
        <div className="text-sm">{specializedContent || children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
