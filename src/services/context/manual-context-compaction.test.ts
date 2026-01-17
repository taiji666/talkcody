import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage } from '@/types/agent';
import { compactTaskContext } from './manual-context-compaction';

const mockCompactContext = vi.hoisted(() => vi.fn());
const mockResolveModelTypeSync = vi.hoisted(() => vi.fn());
const mockGetMessages = vi.hoisted(() => vi.fn());
const mockGetTask = vi.hoisted(() => vi.fn());
const mockSetMessages = vi.hoisted(() => vi.fn());
const mockGetEffectiveWorkspaceRoot = vi.hoisted(() => vi.fn());
const mockWriteFile = vi.hoisted(() => vi.fn());

vi.mock('@/services/ai/ai-context-compaction', () => ({
  aiContextCompactionService: {
    compactContext: mockCompactContext,
  },
}));

vi.mock('@/providers/models/model-type-service', () => ({
  modelTypeService: {
    resolveModelTypeSync: mockResolveModelTypeSync,
  },
}));

vi.mock('@/services/workspace-root-service', () => ({
  getEffectiveWorkspaceRoot: mockGetEffectiveWorkspaceRoot,
}));

vi.mock('@/stores/task-store', () => ({
  useTaskStore: {
    getState: () => ({
      getMessages: mockGetMessages,
      getTask: mockGetTask,
      setMessages: mockSetMessages,
    }),
  },
}));

vi.mock('@/services/task-file-service', () => ({
  taskFileService: {
    writeFile: mockWriteFile,
  },
}));

describe('compactTaskContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetEffectiveWorkspaceRoot.mockResolvedValue('/repo');
    mockResolveModelTypeSync.mockReturnValue('google/gemini-2.5-flash-lite');
    mockWriteFile.mockResolvedValue('/path/to/file');
  });

  it('preserves tool-call and tool-result content when compacting', async () => {
    const taskId = 'task-1';
    mockGetTask.mockReturnValue({ id: taskId, model: 'google/gemini-2.5-flash-lite' });

    const messages: UIMessage[] = [
      { id: 'm1', role: 'user', content: 'Kickoff', timestamp: new Date() },
      { id: 'm2', role: 'assistant', content: 'Ack', timestamp: new Date() },
      { id: 'm3', role: 'user', content: 'Prep', timestamp: new Date() },
      { id: 'm4', role: 'assistant', content: 'Ready', timestamp: new Date() },
      { id: 'm5', role: 'user', content: 'Read file', timestamp: new Date() },
      {
        id: 'm6',
        role: 'tool',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'readFile',
            input: { file_path: '/repo/test.txt' },
          },
        ],
        timestamp: new Date(),
        toolCallId: 'call-1',
        toolName: 'readFile',
      },
      {
        id: 'm7',
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'readFile',
            output: { type: 'text', value: 'hello' },
          },
        ],
        timestamp: new Date(),
        toolCallId: 'call-1',
        toolName: 'readFile',
      },
      { id: 'm8', role: 'assistant', content: 'Done', timestamp: new Date() },
      { id: 'm9', role: 'user', content: 'Next step', timestamp: new Date() },
      { id: 'm10', role: 'assistant', content: 'Final', timestamp: new Date() },
    ];

    mockGetMessages.mockReturnValue(messages);

    mockCompactContext.mockResolvedValue(`
<analysis>summary</analysis>
1. Primary Request and Intent: Test.
2. Key Technical Concepts: Tools.
3. Files and Code Sections: None.
4. Errors and fixes: None.
5. Problem Solving: None.
6. All user messages: test.
7. Pending Tasks: None.
8. Current Work: None.
`);

    const result = await compactTaskContext(taskId);

    expect(result.success).toBe(true);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockSetMessages).not.toHaveBeenCalled();

    // Use compressed messages from result
    const updatedMessages = result.compressedMessages || [];
    const toolMessages = updatedMessages.filter((msg) => msg.role === 'tool');

    expect(toolMessages.length).toBeGreaterThan(0);

    const toolResultContent = toolMessages
      .flatMap((msg) => (Array.isArray(msg.content) ? msg.content : []))
      .find((item) => item.type === 'tool-result');

    expect(toolResultContent?.toolCallId).toBe('call-1');
    expect(toolResultContent?.toolName).toBe('readFile');
    expect(toolResultContent?.output).toEqual({ type: 'text', value: '{"type":"text","value":"hello"}' });
  });

  it('returns no compression needed when summary is empty', async () => {
    const taskId = 'task-2';
    mockGetTask.mockReturnValue({ id: taskId, model: 'google/gemini-2.5-flash-lite' });

    const messages: UIMessage[] = [
      { id: 'm1', role: 'user', content: 'Short', timestamp: new Date() },
      { id: 'm2', role: 'assistant', content: 'Ok', timestamp: new Date() },
    ];

    mockGetMessages.mockReturnValue(messages);
    mockCompactContext.mockResolvedValue('');

    const result = await compactTaskContext(taskId);

    expect(result.success).toBe(false);
    expect(result.message).toContain('No compression needed');
    expect(mockSetMessages).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
