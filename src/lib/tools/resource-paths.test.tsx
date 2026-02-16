import { describe, expect, it, vi } from 'vitest';
import {
  normalizeResourcePath,
  replaceResourcePathsInCommand,
  resolveResourcePath,
  stripResourcePrefix,
} from './resource-paths';

vi.mock('@tauri-apps/api/path', () => ({
  resolveResource: vi.fn(),
}));

import { resolveResource } from '@tauri-apps/api/path';

const mockedResolveResource = vi.mocked(resolveResource);

describe('resource-paths', () => {
  it('normalizes backslashes', () => {
    expect(normalizeResourcePath('ppt-references\\base.md')).toBe('ppt-references/base.md');
  });

  it('strips $RESOURCE prefix (forward slash)', () => {
    expect(stripResourcePrefix('$RESOURCE/ppt-references/base.md')).toBe('ppt-references/base.md');
  });

  it('strips $RESOURCE prefix (backslash)', () => {
    expect(stripResourcePrefix('$RESOURCE\\ppt-references\\base.md')).toBe(
      'ppt-references\\base.md'
    );
  });

  it('resolveResourcePath tries raw path first', async () => {
    mockedResolveResource.mockResolvedValue('/bundle/resources/ppt-references/base.md');

    const result = await resolveResourcePath('ppt-references/base.md');

    expect(result).toBe('/bundle/resources/ppt-references/base.md');
    expect(mockedResolveResource).toHaveBeenCalledWith('ppt-references/base.md');
  });

  it('resolveResourcePath falls back to resources/ prefix', async () => {
    mockedResolveResource
      .mockRejectedValueOnce(new Error('missing'))
      .mockResolvedValueOnce('/bundle/resources/resources/ppt-references/base.md');

    const result = await resolveResourcePath('ppt-references/base.md');

    expect(result).toBe('/bundle/resources/resources/ppt-references/base.md');
    expect(mockedResolveResource).toHaveBeenCalledWith('ppt-references/base.md');
    expect(mockedResolveResource).toHaveBeenCalledWith('resources/ppt-references/base.md');
  });

  it('replaceResourcePathsInCommand preserves original when resolve fails', async () => {
    mockedResolveResource.mockRejectedValue(new Error('missing'));

    const command = 'cat $RESOURCE/ppt-references/base.md';
    const result = await replaceResourcePathsInCommand(command);

    expect(result).toBe(command);
  });
});
