# Ralph Loop Implementation Specification

## Overview

Ralph Loop is a persistent execution mode in TalkCody that repeatedly re-runs the same task with fresh context, while persisting high-signal memory and enforcing deterministic stop criteria. This feature enables AI agents to autonomously iterate through complex tasks, learning from previous attempts until completion criteria are met.

**Commit:** `24261a4ac44e99c2abe17322bf86850858f70c2a`

## Design Concept

### Problem Statement

AI agents often require multiple iterations to complete complex tasks due to:
- Context window limitations
- Learning through trial and error
- Need for progressive refinement
- Requirement to verify work (tests, linting, type checking)

Traditional single-pass execution leaves the agent unable to self-correct or iterate based on execution feedback.

### Solution: Ralph Loop

Ralph Loop implements a controlled iteration loop where:

1. **Fresh Context per Iteration**: Each iteration starts with a clean context, avoiding token bloat
2. **Memory Persistence**: High-signal information (summaries, feedback, state) persists between iterations
3. **Deterministic Stop Criteria**: Clear, automated conditions for when to stop iterating
4. **Completion Promise**: The AI must explicitly declare when the task is complete

### Key Principles

- **Deterministic**: Loop must terminate; no infinite loops allowed
- **Self-Correcting**: Agent learns from previous iterations via persisted feedback
- **Transparent**: Each iteration's state is visible and inspectable
- **Configurable**: Stop criteria and behavior are tunable per task

## Architecture

### System Integration

```
┌─────────────────────────────────────────────────────────────┐
│                      ExecutionService                        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Check Ralph Loop Enabled?                              ││
│  └──────────────────┬──────────────────────────────────────┘│
│                     │ Yes                                     │
│                     ▼                                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              RalphLoopService                            ││
│  │  ┌───────────────────────────────────────────────────┐  ││
│  │  │  Loop:                                           │  ││
│  │  │  1. Build iteration messages                    │  ││
│  │  │  2. Run iteration (LLM agent)                   │  ││
│  │  │  3. Evaluate stop criteria                      │  ││
│  │  │  4. Persist artifacts                           │  ││
│  │  │  5. Update feedback/summary                     │  ││
│  │  └───────────────────────────────────────────────────┘  ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
src/
├── types/
│   └── ralph-loop.ts              # Type definitions
├── services/
│   └── agents/
│       ├── ralph-loop-service.ts  # Core orchestration
│       └── ralph-loop-service.test.ts
├── stores/
│   └── ralph-loop-store.ts        # State management
├── components/
│   └── chat/
│       └── chat-input.tsx         # UI controls
└── locales/
    ├── en.ts                      # English translations
    └── zh.ts                      # Chinese translations
```

## Core Implementation

### Type Definitions

#### RalphLoopConfig

```typescript
export interface RalphLoopConfig {
  enabled: boolean;
  maxIterations: number;           // Maximum iterations (default: 6)
  maxWallTimeMs: number;           // Maximum execution time (default: 60min)
  stopCriteria: RalphLoopStopCriteria;
  memory: RalphLoopMemoryStrategy;
  context: RalphLoopContextFreshness;
}
```

#### Stop Criteria

```typescript
export interface RalphLoopStopCriteria {
  requirePassingTests: boolean;    // Require tests to pass
  requireLint: boolean;            // Require lint to pass
  requireTsc: boolean;             // Require TypeScript check to pass
  requireNoErrors: boolean;        // Require no tool/execution errors
  successRegex?: string;           // Regex pattern for completion (default: '<ralph>COMPLETE</ralph>')
  blockedRegex?: string;           // Regex pattern for blocked state (default: '<ralph>BLOCKED:(.*?)</ralph>')
}
```

#### Stop Reasons

```typescript
export type RalphLoopStopReason =
  | 'complete'      // Task completed successfully
  | 'blocked'       // Task blocked (missing info, etc.)
  | 'max-iterations' // Reached max iteration limit
  | 'max-wall-time'  // Reached time limit
  | 'error'         // Execution error occurred
  | 'unknown';      // Unknown state
```

#### Memory Strategy

```typescript
export interface RalphLoopMemoryStrategy {
  summaryFileName: string;        // 'ralph-summary.md'
  feedbackFileName: string;       // 'ralph-feedback.md'
  stateFileName: string;          // 'ralph-iteration.json'
}
```

#### Context Freshness

```typescript
export interface RalphLoopContextFreshness {
  includeLastNMessages?: number;   // Number of previous messages to include (default: 0)
}
```

### RalphLoopService

The `RalphLoopService` is the core orchestrator for Ralph Loop execution.

#### Main Loop

```typescript
async runLoop(options: RalphLoopRunOptions): Promise<RalphLoopRunResult> {
  // Initialize
  const startTime = Date.now();
  let iterations = 0;
  let stopReason: RalphLoopStopReason = 'unknown';

  while (iterations < config.maxIterations) {
    // Check abort
    if (abortController.signal.aborted) break;

    // Check wall time
    if (Date.now() - startTime > config.maxWallTimeMs) {
      stopReason = 'max-wall-time';
      break;
    }

    // Run iteration
    const iterationResult = await this.runIteration(...);

    // Evaluate stop criteria
    const evaluation = this.evaluateStopCriteria(...);

    // Persist artifacts
    await this.persistIterationArtifacts(...);

    // Check if should stop
    if (evaluation.shouldStop) {
      stopReason = evaluation.stopReason;
      break;
    }
  }

  return { success, fullText, stopReason, iterations };
}
```

#### Iteration Message Building

Each iteration receives a context that includes:

1. **Task**: The original user request
2. **Ralph Summary**: Accumulated summary from previous iterations
3. **Ralph Feedback**: Feedback and error information from previous iterations
4. **Recent Messages**: Optional N recent messages (if `includeLastNMessages` > 0)

```typescript
const promptSections = [
  '## Task',
  userMessage,
];

if (summary) {
  promptSections.push('## Ralph Summary', summary);
}

if (feedback) {
  promptSections.push('## Ralph Feedback', feedback);
}
```

#### Stop Criteria Evaluation

The service evaluates multiple conditions to determine if the loop should stop:

1. **Blocked Marker**: Check if `<ralph>BLOCKED:reason</ralph>` appears in output
2. **Completion Marker**: Check if `<ralph>COMPLETE</ralph>` appears in output
3. **Test Results**: Parse tool results for test commands (if `requirePassingTests`)
4. **Lint Results**: Parse tool results for lint commands (if `requireLint`)
5. **Type Check Results**: Parse tool results for tsc commands (if `requireTsc`)
6. **Error Count**: Check if any errors occurred (if `requireNoErrors`)

#### Tool Command Pattern Matching

The service recognizes common command patterns:

```typescript
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

const TSC_COMMAND_PATTERNS = [
  /^bun\s+run\s+tsc(\b|:)/,
  /^tsc(\b|\s)/
];
```

### Memory Persistence

#### Summary File (`ralph-summary.md`)

Each iteration updates a cumulative summary that includes:

```markdown
# Ralph Loop Summary

## Objective
[Original user task]

## Iteration N
Stop candidate: [stop reason]
Completion marker: [matched / not found]
Stop message: [if applicable]

## Files Changed
- file1.ts
- file2.ts

## Tool Results
- bash (bun run test): passed
- bash (bun run lint): failed

## Errors
- Error message 1
- Error message 2

## Last Output (truncated)
[Agent output, truncated to 1200 chars]

## Previous Summary
[Previous iteration's summary]
```

#### State File (`ralph-iteration.json`)

Persists iteration state for inspection:

```json
{
  "taskId": "task-1",
  "startedAt": 1737864000000,
  "updatedAt": 1737864300000,
  "iteration": 3,
  "stopReason": "complete",
  "stopMessage": "Task completed",
  "completionPromiseMatched": true,
  "errors": []
}
```

### State Management

#### RalphLoopStore

Uses Zustand for UI state management:

```typescript
interface RalphLoopState {
  isRalphLoopEnabled: boolean;
  initialize: () => void;
  toggleRalphLoop: () => void;
  setRalphLoop: (enabled: boolean) => void;
}
```

The store syncs with the settings database:

```typescript
toggleRalphLoop: () => {
  const newState = !currentState;
  set({ isRalphLoopEnabled: newState });
  await useSettingsStore.getState().setRalphLoopEnabled(newState);
}
```

### Settings Integration

#### Global Toggle

Users can enable/disable Ralph Loop globally via:

- Settings database key: `is_ralph_loop_enabled`
- UI: Chat input toggle switch
- Store: `useSettingsStore.getRalphLoopEnabled()`

#### Per-Task Override

Individual tasks can override the global setting:

```typescript
interface TaskSettings {
  ralphLoopEnabled?: boolean;
}
```

The service checks:

1. Task-specific setting (if present)
2. Global setting (fallback)

### Integration with ExecutionService

The execution service branches based on Ralph Loop state:

```typescript
if (useSettingsStore.getState().getRalphLoopEnabled()) {
  // Ralph Loop path
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
    onStatus,
    onAttachment,
  });
  await handleCompletion(result.fullText);
} else {
  // Standard single-pass path
  await llmService.runAgentLoop(...);
}
```

## Completion Promise

The AI agent is instructed to output specific markers:

### System Prompt Additions

```typescript
const COMPLETION_PROMISE = [
  'Ralph Loop completion promise:',
  '- When the task is fully done, output exactly: <ralph>COMPLETE</ralph>',
  '- If blocked, output exactly: <ralph>BLOCKED: reason</ralph>',
].join('\n');
```

### Stop Rules

Additional stop criteria are added to the system prompt:

```typescript
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
```

## User Interface

### Chat Input Control

A toggle switch in the chat input area:

```tsx
<Switch
  checked={isRalphLoopEnabled}
  onCheckedChange={toggleRalphLoop}
  disabled={isLoading}
/>
```

### Hover Card

Provides context and documentation link:

```tsx
<HoverCardContent>
  <h4>Ralph Loop</h4>
  <p>{description}</p>
  <a href={docLinks.features.ralphLoop}>Learn more</a>
</HoverCardContent>
```

### Translations

English:

```typescript
ralphLoop: {
  label: 'Ralph Loop',
  title: 'Ralph Loop',
  description: 'Continuously iterate until completion criteria are met.',
  enabledTooltip: 'Ralph Loop: iterate until completion criteria are met.',
  disabledTooltip: 'Run a single pass without Ralph Loop iterations.',
  learnMore: 'Learn more',
}
```

Chinese:

```typescript
ralphLoop: {
  label: 'Ralph Loop',
  title: 'Ralph Loop',
  description: '持续迭代直到满足完成标准。',
  enabledTooltip: 'Ralph Loop：持续迭代直到满足完成标准。',
  disabledTooltip: '单次执行，不启用 Ralph Loop 迭代。',
  learnMore: '了解更多',
}
```

## Testing

### Test Coverage

The implementation includes comprehensive tests:

```typescript
describe('RalphLoopService', () => {
  it('stops when completion marker appears');
  it('stops when blocked marker appears');
  it('writes iteration artifacts');
  it('respects max iteration limit');
});
```

### Test Strategy

- Mock dependencies (messageService, taskFileService, stores)
- Simulate agent loop execution
- Verify stop criteria evaluation
- Validate artifact persistence
- Test boundary conditions (max iterations, wall time)

## Configuration Examples

### Default Configuration

```typescript
const DEFAULT_CONFIG: RalphLoopConfig = {
  enabled: true,
  maxIterations: 6,
  maxWallTimeMs: 60 * 60 * 1000,  // 1 hour
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
```

### Strict Mode Configuration

```typescript
const STRICT_CONFIG: RalphLoopConfig = {
  ...DEFAULT_CONFIG,
  stopCriteria: {
    requirePassingTests: true,
    requireLint: true,
    requireTsc: true,
    requireNoErrors: true,
  },
};
```

### Per-Task Override

```typescript
const taskSettings: TaskSettings = {
  ralphLoopEnabled: true,
  // ... other settings
};
```

## Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    User Request                          │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │  Ralph Loop Enabled?  │
         └───────────┬───────────┘
                     │ Yes
                     ▼
         ┌───────────────────────┐
         │  Start Loop            │
         │  iterations = 0        │
         └───────────┬───────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │  iteration += 1        │
         └───────────┬───────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │  Build Context:       │
         │  - Task               │
         │  - Summary            │
         │  - Feedback           │
         └───────────┬───────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │  Run AI Agent         │
         │  - Execute tools      │
         │  - Collect output     │
         └───────────┬───────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │  Evaluate:            │
         │  - Blocked marker?    │◄──┐
         │  - Complete marker?   │   │
         │  - Tests passed?      │   │
         │  - Lint passed?       │   │
         │  - No errors?         │   │
         └───────────┬───────────┘   │
                     │               │
          ┌──────────┴──────────┐    │
          │                     │    │
          ▼ Yes                 ▼ No  │
    ┌───────────┐         ┌──────────┴──┐
    │ Stop Loop │         │ Continue    │
    └─────┬─────┘         └─────┬──────┘
          │                     │
          ▼                     │
    ┌───────────┐               │
    │ Persist   │               │
    │ Final     │               │
    │ State     │               │
    └─────┬─────┘               │
          │                     │
          └─────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │  Return Result        │
         └───────────────────────┘
```

## Key Design Decisions

### 1. Fresh Context per Iteration

**Decision:** Each iteration starts with a clean context window, avoiding token bloat from accumulating messages.

**Rationale:**
- Prevents context window overflow
- Encourages concise, focused iterations
- Reduces cost per iteration
- Improves reasoning quality by reducing noise

### 2. Summary-Based Memory

**Decision:** Persist high-signal information (summary, feedback) instead of raw messages.

**Rationale:**
- Maintains learning between iterations
- Provides a clean, structured representation
- Enables the agent to build on previous work
- More efficient than storing all messages

### 3. Explicit Completion Marker

**Decision:** Require the AI to explicitly output `<ralph>COMPLETE</ralph>` to declare completion.

**Rationale:**
- Clear, unambiguous signal
- Allows the AI to reason about completion
- Prevents premature stopping
- Enables debugging (can see why agent thinks it's done)

### 4. Multiple Stop Criteria

**Decision:** Support configurable stop criteria (tests, lint, tsc, errors) beyond just the completion marker.

**Rationale:**
- Verifies code quality before declaring done
- Ensures automated checks pass
- Allows strict enforcement of standards
- Reduces need for human review of failures

### 5. Configurable Per Task

**Decision:** Allow Ralph Loop to be enabled/disabled globally and overridden per task.

**Rationale:**
- Flexibility for different types of tasks
- User control over resource usage
- Can disable for quick, simple tasks
- Can enable for complex, multi-step tasks

## Usage Examples

### Basic Usage

1. Enable Ralph Loop via toggle in chat input
2. Provide task: "Implement user authentication with tests"
3. Agent will:
   - Write code
   - Run tests (fail)
   - Fix bugs
   - Run tests (pass)
   - Output `<ralph>COMPLETE</ralph>`
   - Stop

### Strict Mode Usage

1. Configure stop criteria to require tests, lint, and tsc
2. Provide task: "Add payment processing feature"
3. Agent must:
   - Implement feature
   - Pass tests
   - Pass lint
   - Pass type check
   - Output `<ralph>COMPLETE</ralph>`

### Blocked Example

1. Provide task: "Deploy to production"
2. Agent encounters missing API key
3. Agent outputs: `<ralph>BLOCKED: missing production API key</ralph>`
4. Loop stops with reason: `blocked`
5. User can provide key and resume

## Performance Considerations

### Cost Management

- **Max Iterations:** Limits token usage (default: 6)
- **Max Wall Time:** Prevents runaway execution (default: 1 hour)
- **Fresh Context:** Reduces cost per iteration by avoiding accumulated messages

### Storage

- **Summary File:** Grows with iterations but is truncated
- **State File:** Fixed size, updated each iteration
- **Messages:** Only new messages per iteration, no duplication

### Memory

- **In-Memory State:** Minimal (iteration count, stop reason)
- **File I/O:** Async, non-blocking
- **Zustand Store:** Small, reactive updates

## Future Enhancements

### Potential Improvements

1. **Adaptive Max Iterations:** Dynamically adjust based on task complexity
2. **Parallel Verification:** Run tests/lint in parallel during iteration
3. **Progress Metrics:** Display progress to user (e.g., "3/6 iterations")
4. **Resume Capability:** Continue from interrupted loop
5. **Custom Regex Patterns:** Allow user-defined stop patterns
6. **Iteration Timeouts:** Per-iteration timeout in addition to wall time
7. **Memory Compression:** More sophisticated summarization strategies
8. **Context Presets:** Pre-defined context templates for common tasks

### Integration Opportunities

1. **Plan Mode:** Use Ralph Loop to execute multi-step plans
2. **Worktree:** Run Ralph Loop in worktree for isolated testing
3. **Deep Research:** Loop until research is complete
4. **Code Review:** Iterate until all review issues resolved

## References

- **Commit:** `24261a4ac44e99c2abe17322bf86850858f70c2a`
- **Main Implementation:** `src/services/agents/ralph-loop-service.ts`
- **Type Definitions:** `src/types/ralph-loop.ts`
- **State Management:** `src/stores/ralph-loop-store.ts`
- **Integration:** `src/services/execution-service.ts`
- **UI:** `src/components/chat/chat-input.tsx`
- **Tests:** `src/services/agents/ralph-loop-service.test.ts`

## Summary

Ralph Loop provides a robust, configurable framework for iterative AI task execution. By combining fresh context, persistent memory, and deterministic stop criteria, it enables AI agents to autonomously complete complex tasks with minimal human intervention. The implementation is well-tested, integrates seamlessly with TalkCody's architecture, and provides clear user controls for enabling and configuring the behavior.
