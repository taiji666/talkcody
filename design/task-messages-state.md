# Task/Message State Management Design

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    UI Layer (React)                         │
│  chat-box.tsx + Hooks (useTask, useTasks, useMessages)      │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                   Service Layer                              │
│  TaskService │ MessageService │ ExecutionService             │
│  - Unified entry points                                      │
│  - Synchronous Store update + Async DB persistence           │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│                  State Management                            │
│  TaskStore (persisted) │ ExecutionStore (ephemeral)         │
│  - Zustand                                                   │
│  - Immutable Map-based state                                 │
└────────────────────────────┬────────────────────────────────┘
                             │
                    DatabaseService (SQLite)
```

---

## 1. Write/Update Flow

### 1.1 User Sends Message → AI Response

```
User types message and clicks send
        ↓
chat-box.tsx
        ↓
┌───────────────────────────────────────┐
│ 1. Create Task (new conversation)     │
│    taskService.createTask()           │
│    ├─ TaskStore.addTask() [sync]      │
│    └─ databaseService.createConversation() [async]
└───────────────────────────────────────┘
        ↓
┌───────────────────────────────────────┐
│ 2. Add user message                   │
│    messageService.addUserMessage()    │
│    ├─ TaskStore.addMessage() [sync]   │
│    └─ databaseService.saveMessage() [async await]
└───────────────────────────────────────┘
        ↓
┌───────────────────────────────────────┐
│ 3. Start LLM execution                │
│    executionService.startExecution()  │
│    ├─ ExecutionStore.startExecution() │
│    ├─ Create independent LLMService instance
│    └─ Call llmService.runAgentLoop()  │
└───────────────────────────────────────┘
        ↓
┌───────────────────────────────────────┐
│ 4. LLM callback handling              │
│                                        │
│ onAssistantMessageStart()             │
│   └─ messageService.createAssistantMessage()
│      ├─ TaskStore.addMessage() [sync] │
│      └─ databaseService.saveMessage() [async fire-and-forget]
│                                        │
│ onChunk(text)                         │
│   └─ messageService.updateStreamingContent()
│      ├─ TaskStore.updateMessageContent() [sync]
│      ├─ ExecutionStore.updateStreamingContent() [sync]
│      └─ No DB write                    │
│                                        │
│ onComplete(fullText)                  │
│   └─ messageService.finalizeMessage() │
│      ├─ TaskStore.updateMessageContent(isStreaming=false) [sync]
│      ├─ ExecutionStore.clearStreamingContent() [sync]
│      └─ databaseService.updateMessage() [async await]
│                                        │
│ onToolMessage(toolMessage)            │
│   └─ messageService.addToolMessage()  │
│      ├─ TaskStore.addMessage() or addNestedToolMessage() [sync]
│      └─ databaseService.saveMessage() [async await]
│                                        │
│ onAttachment(attachment)              │
│   └─ messageService.addAttachment()   │
│      ├─ TaskStore.updateMessage() [sync]
│      └─ databaseService.saveAttachment() [async await]
└───────────────────────────────────────┘
```

### 1.2 MessageService Methods Summary

| Method | Purpose | Store Update | DB Persistence |
|--------|---------|--------------|----------------|
| `addUserMessage()` | Add user message | sync | async await |
| `createAssistantMessage()` | Create streaming message | sync | async fire-and-forget |
| `updateStreamingContent()` | Update streaming content | sync | none |
| `finalizeMessage()` | Complete streaming message | sync | async await |
| `addToolMessage()` | Add tool call/result | sync | async await |
| `addAttachment()` | Add attachment | sync | async await |
| `deleteMessage()` | Delete message | sync | async await |
| `deleteMessagesFromIndex()` | Batch delete | sync | async fire-and-forget |
| `updateMessageLocal()` | UI-only update | sync | none |

---

## 2. Read Flow

### 2.1 User Clicks History Conversation

```
User clicks conversation in chat-history
        ↓
chat-history.tsx / chat-box.tsx
        ↓
┌───────────────────────────────────────┐
│ 1. Select Task                        │
│    taskService.selectTask(taskId)     │
│    ├─ TaskStore.setCurrentTaskId() [sync]
│    └─ settingsManager.setCurrentConversationId()
└───────────────────────────────────────┘
        ↓
┌───────────────────────────────────────┐
│ 2. Check message cache                │
│    if (TaskStore.getMessages(taskId).length === 0)
│    ├─ YES: Load messages              │
│    └─ NO:  Use cache (fast path)      │
└───────────────────────────────────────┘
        ↓ (no cache)
┌───────────────────────────────────────┐
│ 3. Load messages                      │
│    taskService.loadMessages(taskId)   │
│    ├─ databaseService.getMessages(taskId)
│    ├─ mapStoredMessagesToUI()         │
│    ├─ TaskStore.setMessages()         │
└───────────────────────────────────────┘
        ↓
┌───────────────────────────────────────┐
│ 4. useTask hook merges data           │
│    ├─ Task (from TaskStore)           │
│    ├─ Messages (from TaskStore)       │
│    ├─ Execution state (from ExecutionStore)
│    └─ Derive streaming content (if running)
└───────────────────────────────────────┘
        ↓
UI renders message list
```

### 2.2 TaskService Methods Summary

| Method | Purpose |
|--------|---------|
| `createTask()` | Create new Task |
| `loadTasks()` | Load all Tasks for a project |
| `loadMessages()` | Load messages for a Task |
| `selectTask()` | Select and load Task (with cache) |
| `deleteTask()` | Delete Task |
| `renameTask()` | Rename Task |
| `updateTaskSettings()` | Update Task settings |
| `updateTaskUsage()` | Update cost/tokens |
| `getTaskDetails()` | Get Task details |
| `startNewChat()` | Start new conversation |

---

## 3. Core File Responsibilities

### 3.1 Services (Business Logic Layer)

| File | Responsibility |
|------|----------------|
| `message-service.ts` | Message operations unified entry, sync Store update + async DB persist |
| `task-service.ts` | Task operations unified entry, load/create/delete Task |
| `execution-service.ts` | LLM execution management, concurrency control (default 3), callback routing |
| `llm-service.ts` | Core LLM agent loop, tool execution |

### 3.2 Stores (State Management Layer)

| File | Responsibility | Persisted |
|------|----------------|-----------|
| `task-store.ts` | Task + Messages state | Yes (maps to DB) |
| `execution-store.ts` | Execution state, streaming content, abort controller | No (ephemeral) |

**TaskStore State Structure:**
```typescript
{
  tasks: Map<string, Task>;
  currentTaskId: string | null;
  messages: Map<string, UIMessage[]>;
  messageAccessOrder: string[];  // LRU tracking
  loadingTasks: boolean;
  error: string | null;
}
```

**ExecutionStore State Structure:**
```typescript
{
  executions: Map<string, TaskExecution>;
  maxConcurrent: number;  // default: 3
}

interface TaskExecution {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'stopped' | 'error';
  abortController: AbortController;
  streamingContent: string;
  isStreaming: boolean;
  serverStatus: string;
  startTime: Date;
  error?: string;
}
```

### 3.3 Hooks (React Integration Layer)

| Hook | Purpose | Returns |
|------|---------|---------|
| `useTask(taskId)` | Single Task data + execution state | `{ task, messages, isRunning, serverStatus, ... }` |
| `useTasks()` | Task list + management operations | `{ tasks, currentTaskId, loadTasks, selectTask, ... }` |
| `useCurrentTask()` | Current Task (based on currentTaskId) | Same as useTask |
| `useAnyTaskRunning()` | Whether any Task is running | `boolean` |
| `useRunningTaskIds()` | Running Task IDs | `string[]` |

---

## 4. Design Principles

### 4.1 Two-Layer State Management

- **Store Layer**: Zustand stores, synchronous UI updates
- **Service Layer**: Coordinate Store + Database
- **Key Benefit**: Immediate UI response + eventual consistency persistence

### 4.2 Callback-Driven Execution

- All events route to Services via callbacks
- Services handle both Store updates and DB persistence
- Decouples LLM Service from persistence logic

### 4.3 Ephemeral vs Persisted State Separation

- `TaskStore`: Persisted Task/Message data
- `ExecutionStore`: Ephemeral execution state (cleared on process exit)
- Hook layer merges both for UI display

### 4.4 Fire-and-Forget vs Await

- Fast operations: fire-and-forget DB updates (streaming chunks)
- Critical operations: await DB updates (finalize message, create task)
- Maintain UI responsiveness while ensuring data consistency

---

## 5. Concurrent Task Support

### 5.1 Concurrent Execution Architecture

ExecutionStore supports up to 3 tasks running simultaneously:

```
┌─────────────────────────────────────────────────────┐
│                    ExecutionStore                    │
│  executions: Map<taskId, TaskExecution>             │
│  - taskId_1: { status: 'running', ... }             │
│  - taskId_2: { status: 'running', ... }             │
│  - taskId_3: { status: 'completed', ... }           │
│                                                      │
│  maxConcurrent: 3                                    │
│  getRunningCount() → 2                               │
│  canStartNew() → true                                │
└─────────────────────────────────────────────────────┘
```

Each task has independent:
- **AbortController**: For cancellation
- **streamingContent**: Streaming content buffer
- **serverStatus**: Status messages (e.g., "Thinking...", "Calling tool...")
- **LLMService instance**: Each task creates an isolated instance

### 5.2 Concurrency Control

```typescript
// ExecutionStore.startExecution()
startExecution: (taskId) => {
  // 1. Check if already running
  if (existing?.status === 'running') {
    return { success: false, error: 'Task is already running' };
  }

  // 2. Check concurrency limit
  if (runningCount >= maxConcurrent) {
    return { success: false, error: 'Maximum concurrent tasks reached' };
  }

  // 3. Create new execution
  return { success: true, abortController: new AbortController() };
}
```

### 5.3 UI Multi-Task Switching

```
┌─────────────────────────────────────────────────────┐
│ [📝 Task A] [🔄 Task B] [🔄 Task C]  [+ New]        │  <-- RunningTasksTabs
├─────────────────────────────────────────────────────┤
│                                                     │
│              Display selected task's messages       │
│              (Tasks continue running in background) │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Key Components**:
- `RunningTasksTabs` (`src/components/chat/running-tasks-tabs.tsx`)
  - Shows tabs for all running tasks
  - Click to switch view, doesn't affect background execution
  - Shows stop button
  - Disables new button when concurrency limit reached

**Related Hooks**:
- `useRunningTaskIds()`: Get list of running task IDs
- `useCanStartNewExecution()`: Check if new task can start

### 5.4 Data Flow

**User starts new task:**
```
1. UI calls executionService.startExecution()
2. ExecutionStore checks concurrency limit → allows, creates execution
3. TaskStore adds new task, sets currentTaskId
4. Creates independent LLMService instance
5. LLMService starts agent loop
```

**User switches task:**
```
1. UI calls taskService.selectTask(taskId)
2. TaskStore.setCurrentTaskId() → updates current display
3. useTask(taskId) returns that task's messages + execution state
4. Background tasks continue running, unaffected
```

**User stops task:**
```
1. UI calls executionService.stopExecution(taskId)
2. ExecutionStore.stopExecution() → calls abortController.abort()
3. LLMService detects abort signal, stops execution
4. ExecutionStore updates status → 'stopped'
```

**Protection Strategy**:
- Current displayed task (`currentTaskId`) is never evicted
- Running tasks (`runningTaskIds`) are never evicted
- Only evicts oldest cache entries exceeding the limit
