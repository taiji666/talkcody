import { z } from 'zod';
import { GenericToolDoing } from '@/components/tools/generic-tool-doing';
import { GenericToolResult } from '@/components/tools/generic-tool-result';
import { createTool } from '@/lib/create-tool';
import { logger } from '@/lib/logger';
import { agentRegistry } from '@/services/agents/agent-registry';
import { isToolAllowedForAgent } from '@/services/agents/agent-tool-access';
import { getAvailableToolsForUISync } from '@/services/agents/tool-registry';
import { useAgentStore } from '@/stores/agent-store';
import type { AgentToolSet } from '@/types/agent';
import { getModelType } from '@/types/model-types';
import type { MCPToolPlaceholder, ToolWithUI } from '@/types/tool';

const dynamicPromptSchema = z
  .object({
    enabled: z.boolean().optional(),
    providers: z.array(z.string()).optional(),
    variables: z.record(z.string(), z.string()).optional(),
    providerSettings: z.record(z.string(), z.unknown()).optional(),
  })
  .optional();

const inputSchema = z.strictObject({
  id: z.string().optional().describe('Optional agent id (kebab-case preferred)'),
  name: z.string().min(1).describe('Agent name'),
  description: z.string().optional().describe('Optional agent description'),
  systemPrompt: z.string().min(1).describe('Required system prompt for the agent'),
  tools: z.array(z.string()).optional().describe('List of tool IDs to enable'),
  modelType: z.string().optional().describe('Model type identifier, e.g., main_model'),
  rules: z.string().optional().describe('Optional agent rules'),
  outputFormat: z.string().optional().describe('Optional agent output format'),
  dynamicPrompt: dynamicPromptSchema,
  defaultSkills: z.array(z.string()).optional().describe('Optional default skill IDs'),
  role: z.enum(['read', 'write']).optional().describe('Primary agent role'),
  canBeSubagent: z.boolean().optional().describe('Allow this agent to be called as subagent'),
  hidden: z.boolean().optional().describe('Hide agent from UI'),
});

type CreateAgentParams = z.infer<typeof inputSchema>;

type CreateAgentResult = {
  success: boolean;
  message: string;
  id?: string;
  name?: string;
  skippedTools?: string[];
  disallowedTools?: string[];
};

function slugifyId(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function resolveAgentTools(
  toolIds: string[],
  agentId: string
): {
  tools: AgentToolSet;
  skippedTools: string[];
  disallowedTools: string[];
} {
  const tools: AgentToolSet = {};
  const skippedTools: string[] = [];
  const disallowedTools: string[] = [];

  let availableTools: Array<{ id: string; ref: unknown }> = [];
  try {
    availableTools = getAvailableToolsForUISync();
  } catch (error) {
    logger.warn('[createAgent] Tools registry not ready, tool list will be empty', error);
  }

  for (const toolId of toolIds) {
    if (!isToolAllowedForAgent(agentId, toolId)) {
      disallowedTools.push(toolId);
      continue;
    }

    const match = availableTools.find((tool) => tool.id === toolId);
    if (match) {
      tools[toolId] = match.ref as ToolWithUI;
      continue;
    }

    if (toolId.includes('__')) {
      const placeholder: MCPToolPlaceholder = {
        _isMCPTool: true,
        _mcpToolName: toolId,
      };
      tools[toolId] = placeholder as unknown as ToolWithUI;
      continue;
    }

    skippedTools.push(toolId);
  }

  return { tools, skippedTools, disallowedTools };
}

export const createAgentTool = createTool({
  name: 'createAgent',
  description: `Create and register a local TalkCody agent.

Use this tool when you need to persist a new agent based on user requirements.`,
  inputSchema,
  canConcurrent: false,
  hidden: true,
  execute: async (params: CreateAgentParams): Promise<CreateAgentResult> => {
    const idBase = slugifyId(params.id || params.name);
    if (!idBase) {
      return {
        success: false,
        message: 'Invalid agent id',
      };
    }

    let newId = idBase;
    let counter = 1;
    while (await agentRegistry.get(newId)) {
      newId = `${idBase}-${counter++}`;
    }

    const { tools, skippedTools, disallowedTools } = resolveAgentTools(params.tools ?? [], newId);

    const dynamicPrompt = params.dynamicPrompt
      ? {
          enabled: params.dynamicPrompt.enabled ?? false,
          providers: params.dynamicPrompt.providers ?? [],
          variables: params.dynamicPrompt.variables ?? {},
          providerSettings: params.dynamicPrompt.providerSettings ?? {},
        }
      : undefined;

    try {
      await agentRegistry.forceRegister({
        id: newId,
        name: params.name,
        description: params.description,
        modelType: getModelType(params.modelType),
        systemPrompt: params.systemPrompt,
        tools,
        rules: params.rules,
        outputFormat: params.outputFormat,
        hidden: params.hidden ?? false,
        isDefault: false,
        dynamicPrompt,
        defaultSkills: params.defaultSkills,
        role: params.role,
        canBeSubagent: params.canBeSubagent ?? true,
      });

      await useAgentStore.getState().refreshAgents();

      const toolNotes = [
        skippedTools.length > 0 ? `Skipped tools: ${skippedTools.join(', ')}` : null,
        disallowedTools.length > 0 ? `Disallowed tools: ${disallowedTools.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' | ');

      const message = toolNotes
        ? `Agent "${params.name}" created (id: "${newId}"). ${toolNotes}`
        : `Agent "${params.name}" created (id: "${newId}").`;

      return {
        success: true,
        message,
        id: newId,
        name: params.name,
        skippedTools,
        disallowedTools,
      };
    } catch (error) {
      logger.error('[createAgent] Failed to create agent', error);
      return {
        success: false,
        message: 'Failed to create agent',
      };
    }
  },
  renderToolDoing: (params: CreateAgentParams) => (
    <GenericToolDoing operation="write" target={params.name} details="Creating local agent" />
  ),
  renderToolResult: (result) => (
    <GenericToolResult
      success={result?.success ?? false}
      message={result?.message}
      error={result?.success ? undefined : result?.message}
    />
  ),
});
