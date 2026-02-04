import { beforeEach, describe, expect, it, vi } from 'vitest';

// Override the global mock from setup.ts for this specific test
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn(),
  normalize: vi.fn(),
}));

// Since we need to test the actual implementation, not the global mock, we need to unmock it
vi.unmock('./repository-utils');

import { join, normalize } from '@tauri-apps/api/path';
import { getFileNameFromPath, getRelativePath, normalizeFilePath } from './repository-utils';

const mockJoin = vi.mocked(join);
const mockNormalize = vi.mocked(normalize);

describe('normalizeFilePath', () => {
  const rootPath = '/root/project';

  beforeEach(() => {
    vi.clearAllMocks();
  });

describe('getFileNameFromPath', () => {
  it('should handle Windows paths', () => {
    expect(getFileNameFromPath('C:\\Users\\dev\\file.ts')).toBe('file.ts');
  });

  it('should handle trailing separators', () => {
    expect(getFileNameFromPath('C:\\Users\\dev\\repo\\')).toBe('repo');
  });

  it('should handle mixed separators', () => {
    expect(getFileNameFromPath('C:/Users/dev\\repo/file.ts')).toBe('file.ts');
  });
});

describe('getRelativePath', () => {
  it('should return relative path for Windows-style root and file', () => {
    const rootPath = 'C:\\Users\\dev\\repo';
    const filePath = 'C:\\Users\\dev\\repo\\src\\index.ts';

    expect(getRelativePath(filePath, rootPath)).toBe('src/index.ts');
  });

  it('should return original path when root does not match', () => {
    const rootPath = 'C:\\Users\\dev\\repo';
    const filePath = 'D:\\Work\\other\\file.ts';

    expect(getRelativePath(filePath, rootPath)).toBe(filePath);
  });
});

  it('should return normalized path for absolute Unix paths', async () => {
    const filePath = '/Users/test/file.txt';
    mockNormalize.mockResolvedValueOnce('/Users/test/file.txt');

    const result = await normalizeFilePath(rootPath, filePath);

    expect(result).toBe('/Users/test/file.txt');
    expect(mockNormalize).toHaveBeenCalledWith(filePath);
    expect(mockJoin).not.toHaveBeenCalled();
  });

  it('should return normalized path for absolute Windows paths', async () => {
    const filePath = 'C:\\Users\\test\\file.txt';
    mockNormalize.mockResolvedValueOnce('C:\\Users\\test\\file.txt');

    const result = await normalizeFilePath(rootPath, filePath);

    expect(result).toBe('C:\\Users\\test\\file.txt');
    expect(mockNormalize).toHaveBeenCalledWith(filePath);
    expect(mockJoin).not.toHaveBeenCalled();
  });

  it('should treat UNC paths as absolute', async () => {
    const filePath = '\\\\server\\share\\file.txt';
    mockNormalize.mockResolvedValueOnce('\\\\server\\share\\file.txt');

    const result = await normalizeFilePath(rootPath, filePath);

    expect(result).toBe('\\\\server\\share\\file.txt');
    expect(mockNormalize).toHaveBeenCalledWith(filePath);
    expect(mockJoin).not.toHaveBeenCalled();
  });

  it('should treat extended Windows paths as absolute', async () => {
    const filePath = '\\\\?\\C:\\Users\\test\\file.txt';
    mockNormalize.mockResolvedValueOnce('\\\\?\\C:\\Users\\test\\file.txt');

    const result = await normalizeFilePath(rootPath, filePath);

    expect(result).toBe('\\\\?\\C:\\Users\\test\\file.txt');
    expect(mockNormalize).toHaveBeenCalledWith(filePath);
    expect(mockJoin).not.toHaveBeenCalled();
  });

  it('should treat extended UNC paths as absolute', async () => {
    const filePath = '\\\\?\\UNC\\server\\share\\file.txt';
    mockNormalize.mockResolvedValueOnce('\\\\?\\UNC\\server\\share\\file.txt');

    const result = await normalizeFilePath(rootPath, filePath);

    expect(result).toBe('\\\\?\\UNC\\server\\share\\file.txt');
    expect(mockNormalize).toHaveBeenCalledWith(filePath);
    expect(mockJoin).not.toHaveBeenCalled();
  });

  it('should join root path when receiving relative paths', async () => {
    const relativePath = 'src/file.ts';
    const joinedPath = `${rootPath}/${relativePath}`;

    mockJoin.mockResolvedValueOnce(joinedPath);
    mockNormalize.mockResolvedValueOnce(joinedPath);

    const result = await normalizeFilePath(rootPath, relativePath);

    expect(mockJoin).toHaveBeenCalledWith(rootPath, relativePath);
    expect(mockNormalize).toHaveBeenCalledWith(joinedPath);
    expect(result).toBe(joinedPath);
  });

  it('should normalize dot segments within paths', async () => {
    const relativePath = './src/../file.ts';
    const joinedPath = `${rootPath}/./src/../file.ts`;
    const normalizedPath = `${rootPath}/file.ts`;

    mockJoin.mockResolvedValueOnce(joinedPath);
    mockNormalize.mockResolvedValueOnce(normalizedPath);

    const result = await normalizeFilePath(rootPath, relativePath);

    expect(mockJoin).toHaveBeenCalledWith(rootPath, relativePath);
    expect(mockNormalize).toHaveBeenCalledWith(joinedPath);
    expect(result).toBe(normalizedPath);
  });
});
