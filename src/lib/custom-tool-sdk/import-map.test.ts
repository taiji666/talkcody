import { describe, expect, it } from 'vitest';
import { __getInternalModuleLoaderKeys } from './import-map';

const TEST_FILE_PATTERNS = [/\.test\./, /\/src\/test\//];

describe('custom tool import map', () => {
  const loaderKeys = __getInternalModuleLoaderKeys();

  it('excludes test files from module registry', () => {
    TEST_FILE_PATTERNS.forEach((pattern) => {
      expect(loaderKeys.some((key) => pattern.test(key))).toBe(false);
    });
  });

  it('still includes regular source files', () => {
    expect(loaderKeys).toContain('/src/lib/utils/debounce.ts');
  });
});
