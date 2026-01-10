import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { useExecutionStore } from '@/stores/execution-store';
import { useTaskStore } from '@/stores/task-store';
import type { Task } from '@/types/task';
import type { UIMessage } from '@/types/agent';
import { useTask } from './use-task';

const createTask = (id: string, title: string): Task => ({
  id,
  title,
  project_id: 'project-1',
  created_at: 1,
  updated_at: 1,
  message_count: 0,
  cost: 0,
  input_token: 0,
  output_token: 0,
});

const createMessage = (id: string, content: string): UIMessage => ({
  id,
  role: 'assistant',
  content,
  timestamp: new Date(),
  isStreaming: false,
});

const resetStores = () => {
  useExecutionStore.setState({ executions: new Map() });
  useTaskStore.setState({
    tasks: new Map(),
    messages: new Map(),
    messageAccessOrder: [],
    loadingMessages: new Set(),
    currentTaskId: null,
  });
};

describe('useTask selectors', () => {
  beforeEach(() => {
    resetStores();
  });

  it('does not rerender when other task messages update', () => {
    const taskA = createTask('task-a', 'Task A');
    const taskB = createTask('task-b', 'Task B');

    const messages = new Map<string, UIMessage[]>();
    messages.set('task-a', [createMessage('a1', 'hello a')]);
    messages.set('task-b', [createMessage('b1', 'hello b')]);

    useTaskStore.setState({
      tasks: new Map([
        ['task-a', taskA],
        ['task-b', taskB],
      ]),
      messages,
    });

    const { result } = renderHook(() => {
      const renderCount = useRef(0);
      renderCount.current += 1;
      return { ...useTask('task-a'), renders: renderCount.current };
    });

    expect(result.current.renders).toBe(1);

    act(() => {
      useTaskStore.setState((state) => {
        const nextMessages = new Map(state.messages);
        const taskBMessages = nextMessages.get('task-b') || [];
        nextMessages.set('task-b', [...taskBMessages, createMessage('b2', 'more b')]);
        return { messages: nextMessages };
      });
    });

    expect(result.current.renders).toBe(1);
  });

  it('rerenders when current task messages update', () => {
    const taskA = createTask('task-a', 'Task A');

    useTaskStore.setState({
      tasks: new Map([['task-a', taskA]]),
      messages: new Map([['task-a', [createMessage('a1', 'hello a')]]]),
    });

    const { result } = renderHook(() => {
      const renderCount = useRef(0);
      renderCount.current += 1;
      return { ...useTask('task-a'), renders: renderCount.current };
    });

    expect(result.current.renders).toBe(1);

    act(() => {
      useTaskStore.setState((state) => {
        const nextMessages = new Map(state.messages);
        const taskAMessages = nextMessages.get('task-a') || [];
        nextMessages.set('task-a', [...taskAMessages, createMessage('a2', 'more a')]);
        return { messages: nextMessages };
      });
    });

    expect(result.current.renders).toBe(2);
  });
});
