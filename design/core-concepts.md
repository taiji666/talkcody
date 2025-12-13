# TalkCody Core Concepts and Data Structures

This document defines the core concepts, types, and key data structures of TalkCody.

---

## 1. Overview

### 1.1 Core Concepts Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Project                                    │
│                  (Project container, organizes conversations)        │
└───────────┬─────────────────────────────────────────────┬───────────┘
            │                                             │
            ▼                                             ▼
┌───────────────────────┐                    ┌────────────────────────┐
│     Repository        │                    │         Task           │
│   (File system/repo)  │                    │   (Conversation/task)  │
│  - FileNode[]         │                    │  - messages[]          │
│  - OpenFile[]         │                    │  - cost, tokens        │
└───────────────────────┘                    └──────────┬─────────────┘
                                                        │
                    ┌───────────────────────────────────┼───────────────┐
                    │                                   │               │
                    ▼                                   ▼               ▼
         ┌──────────────────┐              ┌──────────────────┐  ConversationSkill
         │     Message      │              │      Agent       │       │
         │  (Chat message)  │◄─────────────│  (AI assistant)  │       │
         │  - UIMessage     │   generates  │  - systemPrompt  │       ▼
         │  - StoredMessage │              │  - tools         │   ┌────────┐
         │  - ModelMessage  │              │  - modelType     │   │ Skill  │
         └────────┬─────────┘              └────────┬─────────┘   └────────┘
                  │                                 │
                  │ tool-call/result                │ uses
                  ▼                                 ▼
         ┌──────────────────┐              ┌──────────────────┐
         │      Tool        │◄─────────────│     MCP Tool     │
         │  (Local tool)    │   merged     │  (Remote MCP tool)│
         │  - ToolWithUI    │              │  - prefixedName  │
         └──────────────────┘              └──────────────────┘
                                                    │
                                                    ▼
                                           ┌──────────────────┐
                                           │    MCPServer     │
                                           │  (MCP server)    │
                                           └──────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        Model & Provider                              │
├─────────────────────────────────────────────────────────────────────┤
│  ModelType (MAIN/SMALL/...)  ──►  Model  ──►  Provider             │
│                                   │            - OpenAI             │
│                                   │            - Anthropic          │
│                                   │            - Custom...          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          Command                                     │
│                    (Slash command system)                            │
│  /git, /review, /agent ... ──► CommandExecutor ──► AI or Action    │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Data Flow Overview

```
User Input
    │
    ▼
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Command │───►│   Task   │───►│  Agent   │───►│   LLM    │
│ Parser  │    │  Store   │    │  Loop    │    │ Provider │
└─────────┘    └──────────┘    └──────────┘    └──────────┘
                    │               │               │
                    ▼               ▼               ▼
               UIMessage      Tool Execute     ModelMessage
                    │               │               │
                    └───────────────┴───────────────┘
                                   │
                                   ▼
                            StoredMessage
                         (Database persistence)
```

---

## 2. Core Concept Definitions

### 2.1 Project

Project is the top-level organizational unit that manages repositories and conversations.

```typescript
// src/types/task.ts
interface Project {
  id: string;
  name: string;
  description: string;
  root_path?: string;      // Associated repository path
  context: string;         // Project context prompt
  rules: string;           // Project rules
  created_at: number;
  updated_at: number;
}
```

| Field | Description |
|-------|-------------|
| `root_path` | Associated repository root directory path |
| `context` | Project context injected into system prompt |
| `rules` | Project-level development rules |

---

### 2.2 Task (Conversation)

Task represents a conversation session, storing message history and usage statistics.

```typescript
// src/types/task.ts
interface Task {
  id: string;
  title: string;
  project_id: string;        // Parent project
  message_count: number;
  cost: number;              // Cumulative cost
  input_token: number;       // Cumulative input tokens
  output_token: number;      // Cumulative output tokens
  settings?: string;         // JSON: TaskSettings
  context_usage?: number;    // Context window usage percentage (0-1)
  created_at: number;
  updated_at: number;
}

interface TaskSettings {
  autoApproveEdits?: boolean;  // Auto-approve file edits
}
```

**Runtime State** (TaskStore):

```typescript
// src/stores/task-store.ts
interface TaskState {
  tasks: Map<string, Task>;
  currentTaskId: string | null;
  messages: Map<string, UIMessage[]>;  // LRU cache, max 20 Tasks
  loadingTasks: boolean;
  loadingMessages: Set<string>;
}
```

---

### 2.3 Message

Messages have three representations for different scenarios:

| Type | Purpose | File |
|------|---------|------|
| `UIMessage` | Frontend display | `src/types/agent.ts` |
| `ModelMessage` | LLM interaction (AI SDK) | `ai` package |
| `StoredMessage` | Database persistence | `src/types/message.ts` |

#### UIMessage (Frontend Message)

```typescript
// src/types/agent.ts
interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ToolMessageContent[];
  timestamp: Date;
  isStreaming?: boolean;
  assistantId?: string;              // Agent ID that generated this message
  attachments?: MessageAttachment[];
  // Tool message specific
  toolCallId?: string;
  toolName?: string;
  parentToolCallId?: string;         // Parent ID for nested tools
  nestedTools?: UIMessage[];         // Nested tool messages
  renderDoingUI?: boolean;
}

interface ToolMessageContent {
  type: 'tool-call' | 'tool-result';
  toolCallId: string;
  toolName: string;
  input?: ToolInput;
  output?: ToolOutput;
}

interface MessageAttachment {
  id: string;
  type: 'image' | 'file' | 'code';
  filename: string;
  filePath: string;
  mimeType: string;
  size: number;
  content?: string;
}
```

#### StoredMessage (Database Message)

```typescript
// src/types/message.ts
interface StoredMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;                   // JSON serialized
  timestamp: number;
  assistant_id?: string;
  position_index: number;  // Deprecated, to be removed
  attachments?: MessageAttachment[];
}
```

**Message Conversion Flow**:

```
UIMessage ──(convertToAnthropicFormat)─► ModelMessage ──(AI SDK)─► LLM API
    ▲                                         │
    │                                         ▼
    └────(convertFromAI)────────────── Response Chunks
    │
    ▼
StoredMessage ◄──(serialize)── UIMessage
```

---

### 2.4 Agent (AI Assistant)

Agent defines the capabilities and behavior of an AI assistant.

```typescript
// src/types/agent.ts
interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  modelType: ModelType;              // Model type (not specific model name)
  systemPrompt: string | (() => Promise<string>) | (() => string);
  tools?: ToolSet;
  rules?: string;
  outputFormat?: string;
  hidden?: boolean;                  // Whether to hide in UI
  isDefault?: boolean;               // Whether it's a system default Agent
  version?: string;
  dynamicPrompt?: DynamicPromptConfig;
  defaultSkills?: string[];          // Default enabled skill IDs
  isBeta?: boolean;
  role?: AgentRole;                  // 'information-gathering' | 'content-modification'
}

type AgentRole =
  | 'information-gathering'   // Primarily reads and analyzes
  | 'content-modification';   // Primarily creates, edits, or deletes
```

**Agent Source Types**:

| source_type | Description |
|-------------|-------------|
| `system` | System built-in Agent (code defined) |
| `local` | User locally created |
| `marketplace` | Installed from marketplace |

**Agent Loop Execution**:

```typescript
// src/types/agent.ts
interface AgentLoopOptions {
  messages: UIMessage[];
  model: string;
  systemPrompt?: string;
  tools?: ToolSet;
  isThink?: boolean;                 // Enable thinking
  suppressReasoning?: boolean;
  maxIterations?: number;
  compression?: Partial<CompressionConfig>;
  agentId?: string;
}

interface AgentLoopState {
  messages: ModelMessage[];
  currentIteration: number;
  isComplete: boolean;
  lastFinishReason?: string;
  lastRequestTokens: number;
  hasSkillScripts?: boolean;
}

interface AgentLoopCallbacks {
  onChunk: (chunk: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
  onToolMessage?: (message: UIMessage) => void;
  onStepFinish?: (result: AgentLoopState) => void | Promise<void>;
  onToolCall?: (toolName: string, args: ToolInput) => void | Promise<void>;
  onToolResult?: (toolName: string, result: ToolOutput) => void | Promise<void>;
}
```

---

### 2.5 Tool

Tool is a functional unit that Agents can invoke.

```typescript
// src/types/tool.ts
type ToolInput = Record<string, unknown>;
type ToolOutput = unknown;

interface ToolWithUI<
  TInput extends ToolInput = ToolInput,
  TOutput extends ToolOutput = ToolOutput,
> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;              // Zod validation schema
  execute: (params: TInput) => Promise<TOutput>;
  renderToolDoing: (params: TInput) => ReactElement;    // In-progress UI
  renderToolResult: (result: TOutput, params: TInput) => ReactElement;  // Result UI
  canConcurrent: boolean;            // Whether concurrent execution is supported
  hidden?: boolean;
  isBeta?: boolean;
  badgeLabel?: string;
}
```

**Tool Adaptation Flow**:

```
ToolWithUI ──(convertToolForAI)─► AI SDK Tool
     │
     └──(registerToolUIRenderers)─► UI Renderer Map
```

---

### 2.6 MCP (Model Context Protocol)

MCP allows integration of external tool servers.

```typescript
// src/types/mcp.ts
interface MCPServer {
  id: string;
  name: string;
  url: string;
  protocol: 'http' | 'sse' | 'stdio';
  api_key?: string;
  headers?: Record<string, string>;
  stdio_command?: string;            // stdio protocol command
  stdio_args?: string[];
  stdio_env?: Record<string, string>;
  is_enabled: boolean;
  is_built_in: boolean;
  created_at: number;
  updated_at: number;
}
```

**MCP Tool Naming Convention**:

```
Format: {server_id}__{tool_name}
Example: "openai-api__text-completion"
```

```typescript
// src/types/mcp.ts
interface MCPToolInfo {
  id: string;
  name: string;
  description: string;
  prefixedName: string;              // Full name with prefix
  serverId: string;
  serverName: string;
  isAvailable: boolean;
}

// Utility functions
isMCPTool(toolName: string): boolean
extractMCPServerId(prefixedName: string): string
extractMCPToolName(prefixedName: string): string
```

**MCP Store State**:

```typescript
// src/stores/mcp-store.ts
interface MCPServerWithTools {
  server: MCPServer;
  tools: MCPToolInfo[];
  isConnected: boolean;
  error?: string;
  toolCount: number;
}

interface MCPState {
  servers: MCPServerWithTools[];
  isLoading: boolean;
  error: string | null;
  isHealthy: boolean;
  isInitialized: boolean;
}
```

---

### 2.7 Skill

Skill is an activatable domain knowledge package that injects into system prompts.

```typescript
// src/types/skill.ts
interface Skill {
  id: string;
  name: string;
  description: string;
  longDescription?: string;
  category: string;
  icon?: string;
  content: SkillContent;
  marketplace?: SkillMarketplaceMetadata;
  metadata: SkillLocalMetadata;
  localPath?: string;                // File system path
}

interface SkillContent {
  systemPromptFragment?: string;     // Domain knowledge injected into system prompt
  workflowRules?: string;            // Workflow rules
  documentation?: DocumentationItem[];
  hasScripts?: boolean;
  scriptFiles?: string[];
}

interface SkillLocalMetadata {
  isBuiltIn: boolean;
  sourceType?: 'local' | 'marketplace' | 'system';
  forkedFromId?: string;
  forkedFromMarketplaceId?: string;
  isShared?: boolean;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  lastUsed?: number;
}
```

**File System Skill Structure**:

```
~/.talkcody/skills/
└── skill-name/
    ├── SKILL.md                     # Required: YAML frontmatter + Markdown content
    ├── REFERENCE.md                 # Optional: Reference documentation
    ├── .talkcody-metadata.json      # Optional: Metadata
    └── scripts/                     # Optional: Executable scripts
        └── script.py
```

**Conversation-Skill Association**:

```typescript
interface ConversationSkill {
  conversationId: string;
  skillId: string;
  enabled: boolean;
  priority: number;                  // Priority (higher value = higher priority)
  activatedAt: number;
}
```

---

### 2.8 Model & Provider

#### ModelType

```typescript
// src/types/model-types.ts
enum ModelType {
  MAIN = 'main_model',                          // Main model (complex reasoning)
  SMALL = 'small_model',                        // Small model (fast)
  MESSAGE_COMPACTION = 'message_compaction_model',  // Message compression
  IMAGE_GENERATOR = 'image_generator_model',    // Image generation
  TRANSCRIPTION = 'transcription_model',        // Speech-to-text
}
```

#### ModelConfig

```typescript
// src/types/models.ts
interface ModelConfig {
  name: string;
  imageInput?: boolean;
  audioInput?: boolean;
  imageOutput?: boolean;
  providers: string[];               // List of supported provider IDs
  providerMappings?: Record<string, string>;
  pricing?: { input: string; output: string };
  context_length?: number;
}
```

**Model Identifier Format**: `modelKey@providerId` (e.g., `gpt-4@openai`)

#### Provider

```typescript
// src/types/provider.ts
type ProviderType =
  | 'openai'
  | 'openai-compatible'
  | 'custom'
  | 'custom-openai'
  | 'custom-anthropic';

interface ProviderDefinition {
  id: string;
  name: string;
  priority: number;                  // 0 = highest priority
  apiKeyName: string;
  baseUrl?: string;
  required?: boolean;
  type: ProviderType;
  createProvider?: (apiKey: string, baseUrl?: string) => any;
  isCustom?: boolean;
  customConfig?: CustomProviderConfig;
  supportsCodingPlan?: boolean;
}
```

**Built-in Providers**:

| Provider | Type | Priority | Description |
|----------|------|----------|-------------|
| AI Gateway | custom | 0 | Vercel gateway |
| OpenRouter | custom | 1 | Routing service |
| Ollama | openai-compatible | 1 | Local models |
| LM Studio | openai-compatible | 1 | Local models |
| OpenAI | openai | 2 | - |
| Anthropic | custom | 2 | - |
| Deepseek | openai-compatible | 2 | - |
| Google AI | custom | 2 | - |
| Zhipu | openai-compatible | 2 | Zhipu AI |
| MiniMax | openai-compatible | 2 | - |
| Moonshot | openai-compatible | 2 | Kimi |

---

### 2.9 Command (Slash Commands)

Command is a user-triggerable action via `/`.

```typescript
// src/types/command.ts
enum CommandCategory {
  GIT = 'git',
  CONVERSATION = 'conversation',
  PROJECT = 'project',
  AI = 'ai',
  SYSTEM = 'system',
  CUSTOM = 'custom',
}

enum CommandType {
  ACTION = 'action',           // Execute immediately
  AI_PROMPT = 'ai_prompt',     // Generate prompt to send to AI
  WORKFLOW = 'workflow',       // Complex workflow
  TEXT_INSERT = 'text_insert', // Insert text into input box
}

interface Command {
  id: string;
  name: string;                      // Command name (without /)
  description: string;
  category: CommandCategory;
  type: CommandType;
  parametersSchema?: z.ZodSchema;
  parameters?: CommandParameter[];
  executor: CommandExecutor;
  isBuiltIn: boolean;
  enabled: boolean;
  aliases?: string[];
  icon?: string;
  requiresRepository?: boolean;
  requiresConversation?: boolean;
  examples?: string[];
  preferredAgentId?: string;         // Designated Agent to handle
}

interface CommandContext {
  conversationId?: string;
  repositoryPath?: string;
  selectedFile?: string;
  fileContent?: string;
  sendMessage?: (message: string) => Promise<void>;
  createNewConversation?: () => Promise<void>;
  showNotification?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

interface CommandResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: unknown;
  continueProcessing?: boolean;      // Whether to continue processing (e.g., send to AI)
  aiMessage?: string;
}
```

---

## 3. Data Hierarchy

```
Project
├── root_path ──► Repository
│                 ├── FileNode[] (file tree)
│                 └── OpenFile[] (open files)
│
└── Task[] (conversation list)
    ├── StoredMessage[] (persisted messages)
    │   └── UIMessage (runtime)
    │       └── ToolMessageContent[]
    │
    └── ConversationSkill[] (activated skills)
        └── Skill

Agent
├── modelType ──► ModelType ──► Model ──► Provider
├── tools ──► ToolWithUI[] + MCPTool[]
│             └── MCPServer
└── defaultSkills ──► Skill[]
```

---

## 4. Key Design Patterns

### 4.1 Store Design (Zustand)

| Store | Responsibility | Characteristics |
|-------|---------------|-----------------|
| `TaskStore` | Task + Message state | LRU cache (20 Tasks), async persistence |
| `ExecutionStore` | Execution state | Runtime only, supports 3 concurrent |
| `AgentStore` | Agent list | Synced from Registry |
| `MCPStore` | MCP servers and tools | Connection state management |
| `SkillsStore` | Skill list and activation state | Global activation state |
| `RepositoryStore` | File system state | FileNode lazy loading |

### 4.2 Message Three-Layer Architecture

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐
│  UIMessage  │◄───►│ ModelMessage │◄───►│ StoredMessage │
│  (Frontend) │     │(LLM interact)│     │  (Database)   │
└─────────────┘     └──────────────┘     └───────────────┘
      │                    │                    │
      │  convertToAI()     │  AI SDK           │  serialize()
      │  convertFromAI()   │                   │  deserialize()
      ▼                    ▼                    ▼
   React UI           Vercel AI SDK         SQLite
```

### 4.3 Tool Integration Mechanism

```
Local Tools                           MCP Tools
ToolWithUI[]                          MCPServer[]
     │                                 │
     │ convertToolForAI()              │ getAdaptedTools()
     ▼                                 ▼
Tool Registry ◄────────────────► MCP Adapter
     │                                 │
     └─────────────┬───────────────────┘
                   │
                   ▼
            restoreToolsFromConfig()
                   │
                   ▼
              Merged ToolSet
                   │
                   ▼
            Agent.streamText()
```

---

## 5. Type Directory Structure

All core types are centralized in the `src/types/` directory, with unified exports via `src/types/index.ts`:

```typescript
// Recommended import style
import type { Task, Agent, UIMessage, MCPServer } from '@/types';
```

### 5.1 Type File Structure

```
src/types/
├── index.ts              # Unified export entry
├── agent.ts              # AgentDefinition, UIMessage, AgentLoop*
├── db-agent.ts           # DbAgent (database layer Agent)
├── task.ts               # Task, Project, TaskSettings
├── message.ts            # StoredMessage, StoredToolContent
├── mcp.ts                # MCPServer, MCPToolInfo
├── provider.ts           # ProviderDefinition, ProviderType
├── tool.ts               # ToolWithUI, ToolInput/Output
├── skill.ts              # Skill, SkillContent, ConversationSkill
├── model-types.ts        # ModelType enum
├── models.ts             # ModelConfig
├── command.ts            # Command, CommandContext
├── file-system.ts        # FileNode, RepositoryState
├── git.ts                # GitStatus, FileStatus
├── custom-provider.ts    # CustomProviderConfig
├── api-keys.ts           # ApiKeySettings
├── shortcuts.ts          # ShortcutConfig
├── navigation.ts         # NavigationView, NavigationItem
├── prompt.ts             # PromptContextProvider
├── user-question.ts      # Question, QuestionAnswer
├── file-based-skill.ts   # FileBasedSkill, SkillMdFrontmatter
├── skill-permission.ts   # SkillScriptPermissionLevel
└── marketplace-skill.ts  # MarketplaceSkillMetadata
```

### 5.2 Key File Index

| Concept | Type File | Service/Store File |
|---------|-----------|-------------------|
| Project | `src/types/task.ts` | `src/services/database/project-service.ts` |
| Task | `src/types/task.ts` | `src/stores/task-store.ts` |
| Message (UI) | `src/types/agent.ts` | `src/services/message-service.ts` |
| Message (DB) | `src/types/message.ts` | `src/services/message-service.ts` |
| Agent (definition) | `src/types/agent.ts` | `src/stores/agent-store.ts` |
| Agent (database) | `src/types/db-agent.ts` | `src/services/agents/agent-registry.ts` |
| Tool | `src/types/tool.ts` | `src/services/agents/tool-registry.ts` |
| MCP | `src/types/mcp.ts` | `src/stores/mcp-store.ts` |
| Skill | `src/types/skill.ts` | `src/stores/skills-store.ts` |
| Model | `src/types/model-types.ts` | `src/lib/models.ts` |
| Provider | `src/types/provider.ts` | `src/providers/provider_registry.ts` |
| Command | `src/types/command.ts` | - |
