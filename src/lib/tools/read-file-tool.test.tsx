import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/path', () => ({
  resolveResource: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(),
  exists: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/services/workspace-root-service', () => ({
  getEffectiveWorkspaceRoot: vi.fn().mockResolvedValue('/repo'),
}));

vi.mock('@/services/repository-utils', () => ({
  normalizeFilePath: vi.fn(async (_root: string, path: string) => path),
}));

vi.mock('@/services/repository-service', () => ({
  repositoryService: {
    readFileWithCache: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  default: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { resolveResource } from '@tauri-apps/api/path';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { readFile } from './read-file-tool';

const testContext = { taskId: 'task-123' };

describe('readFile tool resource handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads bundled resources using resolveResource', async () => {
    vi.mocked(resolveResource).mockResolvedValue('/bundle/resources/base-prompt.md');
    vi.mocked(readTextFile).mockResolvedValue('bundled content');

    const result = await readFile.execute(
      { file_path: '$RESOURCE/ppt-references/base-prompt.md' },
      testContext
    );

    expect(result.success).toBe(true);
    expect(resolveResource).toHaveBeenCalledWith('ppt-references/base-prompt.md');
    expect(readTextFile).toHaveBeenCalledWith('/bundle/resources/base-prompt.md');
    expect(result.content).toBe('bundled content');
  });

  it('returns not found when bundled resource is missing', async () => {
    vi.mocked(resolveResource).mockRejectedValue(new Error('missing resource'));
    vi.mocked(readTextFile).mockRejectedValue(new Error('missing resource file'));

    const result = await readFile.execute(
      { file_path: '$RESOURCE/ppt-references/missing.md' },
      testContext
    );

    expect(result.success).toBe(false);
    expect(result.message).toBe('Resource file not found: ppt-references/missing.md');
  });
});
