import { beforeEach, describe, expect, it, vi } from 'vitest';
import { replaceResourcePathsInCommand } from './resource-paths';

vi.mock('@tauri-apps/api/path', () => ({
  resolveResource: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { resolveResource } from '@tauri-apps/api/path';

const mockedResolveResource = vi.mocked(resolveResource);

describe('resource-paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('replaceResourcePathsInCommand', () => {
    it('returns command unchanged when no $RESOURCE references', async () => {
      const command = 'ls -la /Users/test/project';
      const result = await replaceResourcePathsInCommand(command);

      expect(result).toBe(command);
      expect(mockedResolveResource).not.toHaveBeenCalled();
    });

    it('resolves single $RESOURCE reference using resolveResource', async () => {
      mockedResolveResource.mockResolvedValue('/bundle/resources/ppt-references/scripts/merge.ts');

      const command = 'bun $RESOURCE/ppt-references/scripts/merge.ts slides/test';
      const result = await replaceResourcePathsInCommand(command);

      expect(result).toBe('bun /bundle/resources/ppt-references/scripts/merge.ts slides/test');
      expect(mockedResolveResource).toHaveBeenCalledWith('ppt-references/scripts/merge.ts');
    });

    it('resolves multiple $RESOURCE references in same command', async () => {
      mockedResolveResource
        .mockResolvedValueOnce('/bundle/resources/ppt-references/scripts/merge.ts')
        .mockResolvedValueOnce('/bundle/resources/ppt-references/base-prompt.md');

      const command =
        'bun $RESOURCE/ppt-references/scripts/merge.ts $RESOURCE/ppt-references/base-prompt.md';
      const result = await replaceResourcePathsInCommand(command);

      expect(result).toBe(
        'bun /bundle/resources/ppt-references/scripts/merge.ts /bundle/resources/ppt-references/base-prompt.md'
      );
      expect(mockedResolveResource).toHaveBeenCalledTimes(2);
    });

    it('handles Windows-style backslashes in $RESOURCE paths', async () => {
      mockedResolveResource.mockResolvedValue('/bundle/resources/ppt-references/scripts/merge.ts');

      const command = 'bun $RESOURCE\\ppt-references\\scripts\\merge.ts slides/test';
      const result = await replaceResourcePathsInCommand(command);

      expect(result).toBe('bun /bundle/resources/ppt-references/scripts/merge.ts slides/test');
      expect(mockedResolveResource).toHaveBeenCalledWith('ppt-references/scripts/merge.ts');
    });

    it('handles quoted $RESOURCE paths', async () => {
      mockedResolveResource.mockResolvedValue('/bundle/resources/ppt-references/base-prompt.md');

      const command = 'cat "$RESOURCE/ppt-references/base-prompt.md"';
      const result = await replaceResourcePathsInCommand(command);

      expect(result).toBe('cat "/bundle/resources/ppt-references/base-prompt.md"');
    });

    it('handles complex command with pipes and $RESOURCE', async () => {
      mockedResolveResource.mockResolvedValue('/bundle/resources/ppt-references/base-prompt.md');

      const command = 'cat $RESOURCE/ppt-references/base-prompt.md | grep "test" | head -5';
      const result = await replaceResourcePathsInCommand(command);

      expect(result).toBe(
        'cat /bundle/resources/ppt-references/base-prompt.md | grep "test" | head -5'
      );
    });

    it('preserves original command when resolveResource fails', async () => {
      mockedResolveResource.mockRejectedValue(new Error('Resource not found'));

      const command = 'cat $RESOURCE/ppt-references/base-prompt.md';
      const result = await replaceResourcePathsInCommand(command);

      expect(result).toBe(command);
    });

    it('resolves nested resource paths correctly', async () => {
      mockedResolveResource.mockResolvedValue('/bundle/resources/ppt-references/styles/blueprint.md');

      const command = 'cat $RESOURCE/ppt-references/styles/blueprint.md';
      const result = await replaceResourcePathsInCommand(command);

      expect(result).toBe('cat /bundle/resources/ppt-references/styles/blueprint.md');
      expect(mockedResolveResource).toHaveBeenCalledWith('ppt-references/styles/blueprint.md');
    });

    it('handles command with $RESOURCE at different positions', async () => {
      mockedResolveResource
        .mockResolvedValueOnce('/bundle/resources/file1.md')
        .mockResolvedValueOnce('/bundle/resources/file2.md');

      const command = '$RESOURCE/file1.md some args $RESOURCE/file2.md';
      const result = await replaceResourcePathsInCommand(command);

      expect(result).toBe('/bundle/resources/file1.md some args /bundle/resources/file2.md');
    });

    it('handles empty or malformed $RESOURCE references gracefully', async () => {
      const command = 'echo $RESOURCE/';
      const result = await replaceResourcePathsInCommand(command);

      expect(result).toBe(command);
    });
  });
});
