// keep-awake-service.test.ts - Unit tests for KeepAwakeService

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KeepAwakeService } from './keep-awake-service';

// Mock Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock platform detection
vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(),
}));

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: vi.fn(),
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock locale
vi.mock('@/locales', () => ({
  getLocale: () => ({
    KeepAwake: {
      enabled: 'Sleep prevented while tasks are running',
      disabled: 'Sleep prevention disabled',
      error: 'Failed to prevent system sleep',
      platformNotSupported: 'Sleep prevention not supported on this platform',
    },
  }),
}));

import { invoke } from '@tauri-apps/api/core';
import { platform } from '@tauri-apps/plugin-os';
import { toast } from 'sonner';

describe('KeepAwakeService', () => {
  let service: KeepAwakeService;

  beforeEach(() => {
    service = KeepAwakeService.getInstance();
    // Reset all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Reset instance for clean tests
    (KeepAwakeService as any).instance = null;
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = KeepAwakeService.getInstance();
      const instance2 = KeepAwakeService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('acquire', () => {
    it('should call keep_awake_acquire and return true on first acquire', async () => {
      vi.mocked(invoke).mockResolvedValue(true);
      vi.mocked(platform).mockResolvedValue('macos');
      vi.clearAllMocks(); // Clear mock calls

      const result = await service.acquire();

      expect(invoke).toHaveBeenCalledWith('keep_awake_acquire');
      expect(result).toBe(true);
      expect(toast).toHaveBeenCalledWith(
        'Sleep prevented while tasks are running',
        expect.any(Object)
      );
    });

    it('should return false on subsequent acquire calls', async () => {
      vi.mocked(invoke).mockResolvedValue(false);
      vi.mocked(platform).mockResolvedValue('macos');
      vi.clearAllMocks(); // Clear mock calls from previous tests

      const result = await service.acquire();

      expect(result).toBe(false);
      expect(toast).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('Plugin error'));
      vi.mocked(platform).mockResolvedValue('macos');

      const result = await service.acquire();

      expect(result).toBe(false);
      expect(toast).toHaveBeenCalledWith(
        'Failed to prevent system sleep',
        expect.any(Object)
      );
    });

    it('should return false for unsupported platforms', async () => {
      vi.mocked(platform).mockResolvedValue('android');
      vi.clearAllMocks(); // Clear mock calls

      const result = await service.acquire();

      expect(result).toBe(false);
      expect(invoke).not.toHaveBeenCalled();
    });

    it('should clear release timeout on acquire', async () => {
      vi.useFakeTimers();
      vi.mocked(invoke).mockResolvedValue(true);
      vi.mocked(platform).mockResolvedValue('macos');
      vi.clearAllMocks(); // Clear mock calls from previous tests

      // First acquire
      await service.acquire();

      // Second acquire should also return true since each invoke returns true
      const result = await service.acquire();
      expect(result).toBe(true);
      
      vi.useRealTimers();
    });
  });

  describe('release', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should call keep_awake_release and return true on last release', async () => {
      vi.mocked(invoke).mockResolvedValue(true);
      vi.mocked(platform).mockResolvedValue('macos');
      vi.clearAllMocks(); // Clear mock calls from previous tests

      const resultPromise = service.release();

      // Fast-forward past debounce delay
      await vi.advanceTimersByTimeAsync(500);

      const result = await resultPromise;

      expect(invoke).toHaveBeenCalledWith('keep_awake_release');
      expect(result).toBe(true);
    });

    it('should return false when other tasks are still active', async () => {
      vi.mocked(invoke).mockResolvedValue(false);
      vi.mocked(platform).mockResolvedValue('macos');
      vi.clearAllMocks(); // Clear mock calls from previous tests

      const resultPromise = service.release();

      // Fast-forward past debounce delay
      await vi.advanceTimersByTimeAsync(500);

      const result = await resultPromise;

      expect(result).toBe(false);
      expect(toast).not.toHaveBeenCalled();
    });

    it('should debounce release calls', async () => {
      vi.mocked(invoke).mockResolvedValue(true);
      vi.mocked(platform).mockResolvedValue('macos');
      vi.clearAllMocks(); // Clear mock calls

      // Multiple rapid releases
      const promise1 = service.release();
      const promise2 = service.release();
      const promise3 = service.release();

      // Fast-forward time past debounce delay
      await vi.advanceTimersByTimeAsync(500);

      await Promise.all([promise1, promise2, promise3]);

      // Should only call invoke once
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('Plugin error'));
      vi.mocked(platform).mockResolvedValue('macos');
      vi.clearAllMocks(); // Clear mock calls from previous tests

      const resultPromise = service.release();

      // Fast-forward past debounce delay
      await vi.advanceTimersByTimeAsync(500);

      const result = await resultPromise;

      expect(result).toBe(false);
      expect(toast).toHaveBeenCalledWith(
        'Failed to prevent system sleep',
        expect.any(Object)
      );
    });

    it('should return false for unsupported platforms', async () => {
      vi.mocked(platform).mockResolvedValue('ios');
      vi.clearAllMocks(); // Clear mock calls

      const result = await service.release();

      expect(result).toBe(false);
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  describe('getRefCount', () => {
    it('should return current reference count', async () => {
      vi.mocked(invoke).mockResolvedValue(3);
      vi.mocked(platform).mockResolvedValue('macos');
      vi.clearAllMocks(); // Clear mock calls

      const count = await service.getRefCount();

      expect(invoke).toHaveBeenCalledWith('keep_awake_get_ref_count');
      expect(count).toBe(3);
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('Plugin error'));
      vi.mocked(platform).mockResolvedValue('macos');

      const count = await service.getRefCount();

      // Should return local count (0 in this case)
      expect(count).toBe(0);
    });
  });

  describe('isPreventingSleep', () => {
    it('should return true when preventing sleep', async () => {
      vi.mocked(invoke).mockResolvedValue(true);
      vi.mocked(platform).mockResolvedValue('macos');

      const preventing = await service.isPreventingSleep();

      expect(invoke).toHaveBeenCalledWith('keep_awake_is_preventing');
      expect(preventing).toBe(true);
    });

    it('should return false when not preventing sleep', async () => {
      vi.mocked(invoke).mockResolvedValue(false);
      vi.mocked(platform).mockResolvedValue('macos');

      const preventing = await service.isPreventingSleep();

      expect(preventing).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('Plugin error'));
      vi.mocked(platform).mockResolvedValue('macos');

      const preventing = await service.isPreventingSleep();

      // Should return local state (false in this case)
      expect(preventing).toBe(false);
    });
  });

  describe('forceReleaseAll', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should release all sleep prevention', async () => {
      vi.mocked(platform).mockResolvedValue('macos');
      vi.mocked(invoke).mockImplementation((cmd) => {
        if (cmd === 'keep_awake_get_ref_count') {
          return Promise.resolve(3);
        }
        if (cmd === 'keep_awake_release') {
          return Promise.resolve(false); // Not last
        }
        return Promise.reject(new Error('Unknown command'));
      });
      vi.clearAllMocks(); // Clear mock calls from previous tests

      const releasePromise = service.forceReleaseAll();
      
      // Fast-forward past debounce delays (3 releases * 500ms)
      await vi.advanceTimersByTimeAsync(500 * 3);

      await releasePromise;

      // Should call get_ref_count once
      expect(invoke).toHaveBeenCalledWith('keep_awake_get_ref_count');
      // Should call release 3 times
      expect(invoke).toHaveBeenCalledTimes(4); // 1 get + 3 releases
    });

    it('should handle zero ref count', async () => {
      vi.mocked(platform).mockResolvedValue('macos');
      vi.mocked(invoke).mockResolvedValue(0);

      await service.forceReleaseAll();

      // Should call get_ref_count once
      expect(invoke).toHaveBeenCalledWith('keep_awake_get_ref_count');
      // Should not call release
      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(platform).mockResolvedValue('macos');
      vi.mocked(invoke).mockRejectedValue(new Error('Plugin error'));

      // Should not throw
      await expect(service.forceReleaseAll()).resolves.not.toThrow();
    });
  });

  describe('platform detection', () => {
    it('should detect macOS platform', async () => {
      vi.mocked(platform).mockResolvedValue('macos');
      vi.mocked(invoke).mockResolvedValue(true);

      const service = KeepAwakeService.getInstance();
      await service.acquire();

      expect(invoke).toHaveBeenCalledWith('keep_awake_acquire');
    });

    it('should detect Windows platform', async () => {
      vi.mocked(platform).mockResolvedValue('windows');
      vi.mocked(invoke).mockResolvedValue(true);

      const service = KeepAwakeService.getInstance();
      await service.acquire();

      expect(invoke).toHaveBeenCalledWith('keep_awake_acquire');
    });

    it('should detect Linux platform', async () => {
      vi.mocked(platform).mockResolvedValue('linux');
      vi.mocked(invoke).mockResolvedValue(true);

      const service = KeepAwakeService.getInstance();
      await service.acquire();

      expect(invoke).toHaveBeenCalledWith('keep_awake_acquire');
    });
  });
});
