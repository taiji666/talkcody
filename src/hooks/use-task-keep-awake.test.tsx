// use-task-keep-awake.test.tsx - Unit tests for useTaskKeepAwake hook

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTaskKeepAwake, useIsPreventingSleep } from './use-task-keep-awake';
import { useExecutionStore } from '@/stores/execution-store';

// Mock keep-awake service
vi.mock('@/services/keep-awake-service', () => ({
  keepAwakeService: {
    acquire: vi.fn(),
    release: vi.fn(),
    isPreventingSleep: vi.fn(),
    getRefCount: vi.fn(),
    forceReleaseAll: vi.fn(),
  },
}));

// Mock execution store
vi.mock('@/stores/execution-store', () => ({
  useExecutionStore: vi.fn(),
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

import { keepAwakeService } from '@/services/keep-awake-service';

describe('useTaskKeepAwake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all mock implementations
    vi.mocked(keepAwakeService.acquire).mockResolvedValue(true);
    vi.mocked(keepAwakeService.release).mockResolvedValue(true);
    vi.mocked(keepAwakeService.isPreventingSleep).mockResolvedValue(false);
    vi.mocked(keepAwakeService.getRefCount).mockResolvedValue(0);
    vi.mocked(keepAwakeService.forceReleaseAll).mockResolvedValue(undefined);
    vi.mocked(useExecutionStore).mockImplementation((selector) => {
      if (selector === 'getRunningCount') {
        return 0 as any;
      }
      return {} as any;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should sync with keep-awake service on mount', async () => {
      vi.mocked(keepAwakeService.isPreventingSleep).mockResolvedValue(true);
      vi.mocked(keepAwakeService.getRefCount).mockResolvedValue(1);
      vi.mocked(useExecutionStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({ getRunningCount: () => 0 });
        }
        return {} as any;
      });

      const { result } = renderHook(() => useTaskKeepAwake());

      await waitFor(() => {
        expect(result.current.isPreventing).toBe(true);
        expect(result.current.refCount).toBe(1);
      });
    });

    it('should handle sync errors gracefully', async () => {
      vi.mocked(keepAwakeService.isPreventingSleep).mockRejectedValue(
        new Error('Sync error')
      );
      vi.mocked(useExecutionStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({ getRunningCount: () => 0 });
        }
        return {} as any;
      });

      const { result } = renderHook(() => useTaskKeepAwake());

      // Should not throw, just log error
      await waitFor(() => {
        expect(result.current.isPreventing).toBe(false);
      });
    });
  });

  describe('task state changes', () => {
    it('should acquire sleep prevention when first task starts', async () => {
      let runningCount = 0;
      vi.mocked(keepAwakeService.acquire).mockResolvedValue(true);
      vi.mocked(keepAwakeService.release).mockResolvedValue(true);
      vi.mocked(useExecutionStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({ getRunningCount: () => runningCount });
        }
        return {} as any;
      });

      const { result, rerender } = renderHook(() => useTaskKeepAwake());

      // Initial state: no tasks running
      await waitFor(() => {
        expect(result.current.runningCount).toBe(0);
      });

      // Simulate first task starting
      runningCount = 1;
      rerender();

      await waitFor(() => {
        expect(keepAwakeService.acquire).toHaveBeenCalled();
        expect(result.current.isPreventing).toBe(true);
      });
    });

    it('should release sleep prevention when all tasks complete', async () => {
      let runningCount = 0;
      vi.mocked(keepAwakeService.acquire).mockResolvedValue(true);
      vi.mocked(keepAwakeService.release).mockResolvedValue(true);
      vi.mocked(keepAwakeService.isPreventingSleep).mockResolvedValue(true);
      vi.mocked(keepAwakeService.getRefCount).mockResolvedValue(1);
      vi.mocked(useExecutionStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({ getRunningCount: () => runningCount });
        }
        return {} as any;
      });

      const { result, rerender } = renderHook(() => useTaskKeepAwake());

      // Initial state: no tasks running
      await waitFor(() => {
        expect(result.current.runningCount).toBe(0);
      });

      // Simulate task starting (should call acquire)
      runningCount = 1;
      rerender();

      await waitFor(() => {
        expect(keepAwakeService.acquire).toHaveBeenCalled();
        expect(result.current.isPreventing).toBe(true);
      });

      // Clear previous calls
      vi.clearAllMocks();
      vi.mocked(keepAwakeService.release).mockResolvedValue(true);

      // Simulate task completing
      runningCount = 0;
      rerender();

      await waitFor(() => {
        expect(keepAwakeService.release).toHaveBeenCalled();
      });

      // Wait for debounce timeout using fake timers
      vi.useFakeTimers();
      vi.advanceTimersByTime(600);
      vi.useRealTimers();
    });

    it('should handle concurrent tasks without redundant calls', async () => {
      let runningCount = 1;
      vi.mocked(keepAwakeService.acquire).mockResolvedValue(true);
      vi.mocked(keepAwakeService.release).mockResolvedValue(false);
      vi.mocked(keepAwakeService.isPreventingSleep).mockResolvedValue(true);
      vi.mocked(keepAwakeService.getRefCount).mockResolvedValue(1);
      vi.mocked(useExecutionStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({ getRunningCount: () => runningCount });
        }
        return {} as any;
      });

      const { result, rerender } = renderHook(() => useTaskKeepAwake());

      // Initial state: 1 task running
      await waitFor(() => {
        expect(result.current.runningCount).toBe(1);
      });

      // Simulate 2 more tasks starting (concurrent)
      runningCount = 3;
      rerender();

      await waitFor(() => {
        expect(result.current.runningCount).toBe(3);
      });

      // Should not call acquire again
      expect(keepAwakeService.acquire).toHaveBeenCalledTimes(1);
    });

    it('should not call acquire/release when tasks are already running', async () => {
      // Start with tasks already running
      let runningCount = 0;
      vi.mocked(keepAwakeService.acquire).mockResolvedValue(true);
      vi.mocked(keepAwakeService.release).mockResolvedValue(false);
      vi.mocked(keepAwakeService.isPreventingSleep).mockResolvedValue(true);
      vi.mocked(keepAwakeService.getRefCount).mockResolvedValue(1);
      vi.mocked(useExecutionStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({ getRunningCount: () => runningCount });
        }
        return {} as any;
      });

      const { result, rerender } = renderHook(() => useTaskKeepAwake());

      // Initial state: 0 tasks running (should not call acquire yet)
      await waitFor(() => {
        expect(result.current.runningCount).toBe(0);
        expect(result.current.isPreventing).toBe(true); // Synced from service
      });

      // Clear mock calls to check what happens next
      vi.clearAllMocks();
      vi.mocked(keepAwakeService.acquire).mockResolvedValue(true);
      vi.mocked(keepAwakeService.release).mockResolvedValue(false);
      vi.mocked(keepAwakeService.isPreventingSleep).mockResolvedValue(true);
      vi.mocked(keepAwakeService.getRefCount).mockResolvedValue(1);

      // Simulate first task starting (should call acquire)
      runningCount = 1;
      rerender();

      await waitFor(() => {
        expect(keepAwakeService.acquire).toHaveBeenCalled();
        expect(result.current.runningCount).toBe(1);
      });

      // Clear mock calls to check what happens next
      vi.clearAllMocks();
      vi.mocked(keepAwakeService.acquire).mockResolvedValue(true);
      vi.mocked(keepAwakeService.release).mockResolvedValue(false);
      vi.mocked(keepAwakeService.isPreventingSleep).mockResolvedValue(true);
      vi.mocked(keepAwakeService.getRefCount).mockResolvedValue(1);

      // Simulate task count change from 1 to 2 (still > 0, should not call acquire/release)
      runningCount = 2;
      rerender();

      await waitFor(() => {
        expect(result.current.runningCount).toBe(2);
      });

      // Should not call acquire or release because tasks were already running
      expect(keepAwakeService.acquire).not.toHaveBeenCalled();
      expect(keepAwakeService.release).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should release all sleep prevention on unmount', async () => {
      vi.mocked(keepAwakeService.isPreventingSleep).mockResolvedValue(true);
      vi.mocked(keepAwakeService.getRefCount).mockResolvedValue(2);
      vi.mocked(useExecutionStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({ getRunningCount: () => 2 });
        }
        return {} as any;
      });

      const { unmount } = renderHook(() => useTaskKeepAwake());

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      unmount();

      await waitFor(() => {
        expect(keepAwakeService.forceReleaseAll).toHaveBeenCalled();
      });
    });

    it('should not call forceReleaseAll if not preventing sleep', async () => {
      vi.mocked(keepAwakeService.isPreventingSleep).mockResolvedValue(false);
      vi.mocked(keepAwakeService.getRefCount).mockResolvedValue(0);
      vi.mocked(useExecutionStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({ getRunningCount: () => 0 });
        }
        return {} as any;
      });

      const { unmount } = renderHook(() => useTaskKeepAwake());

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      unmount();

      await waitFor(() => {
        expect(keepAwakeService.forceReleaseAll).not.toHaveBeenCalled();
      });
    });

    it('should handle cleanup errors gracefully', async () => {
      vi.mocked(keepAwakeService.isPreventingSleep).mockResolvedValue(true);
      vi.mocked(keepAwakeService.getRefCount).mockResolvedValue(1);
      vi.mocked(keepAwakeService.forceReleaseAll).mockRejectedValue(
        new Error('Cleanup error')
      );
      vi.mocked(useExecutionStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({ getRunningCount: () => 1 });
        }
        return {} as any;
      });

      const { unmount } = renderHook(() => useTaskKeepAwake());

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should not throw
      expect(() => unmount()).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should handle acquire errors gracefully', async () => {
      let runningCount = 0;
      vi.mocked(keepAwakeService.acquire).mockRejectedValue(
        new Error('Acquire error')
      );
      vi.mocked(useExecutionStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({ getRunningCount: () => runningCount });
        }
        return {} as any;
      });

      const { result, rerender } = renderHook(() => useTaskKeepAwake());

      // Simulate task starting
      runningCount = 1;
      rerender();

      // Should not throw
      await waitFor(() => {
        expect(result.current.isPreventing).toBe(false);
      });
    });

    it('should handle release errors gracefully', async () => {
      let runningCount = 1;
      vi.mocked(keepAwakeService.acquire).mockResolvedValue(true);
      vi.mocked(keepAwakeService.release).mockRejectedValue(
        new Error('Release error')
      );
      vi.mocked(keepAwakeService.isPreventingSleep).mockResolvedValue(true);
      vi.mocked(keepAwakeService.getRefCount).mockResolvedValue(1);
      vi.mocked(useExecutionStore).mockImplementation((selector) => {
        if (typeof selector === 'function') {
          return selector({ getRunningCount: () => runningCount });
        }
        return {} as any;
      });

      const { result, rerender } = renderHook(() => useTaskKeepAwake());

      // Initial state: task running
      await waitFor(() => {
        expect(result.current.isPreventing).toBe(true);
      });

      // Simulate task completing
      runningCount = 0;
      rerender();

      // Wait for debounce timeout using fake timers
      vi.useFakeTimers();
      vi.advanceTimersByTime(600);
      vi.useRealTimers();

      // Should not throw
      await waitFor(() => {
        expect(result.current.runningCount).toBe(0);
      });
    });
  });
});

describe('useIsPreventingSleep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useExecutionStore).mockImplementation((selector) => {
      if (typeof selector === 'function') {
        return selector({ getRunningCount: () => 0 });
      }
      return {} as any;
    });
  });

  it('should return isPreventing value from useTaskKeepAwake', async () => {
    vi.mocked(keepAwakeService.isPreventingSleep).mockResolvedValue(true);
    vi.mocked(keepAwakeService.getRefCount).mockResolvedValue(1);
    vi.mocked(useExecutionStore).mockImplementation((selector) => {
      if (typeof selector === 'function') {
        return selector({ getRunningCount: () => 0 });
      }
      return {} as any;
    });

    const { result } = renderHook(() => useIsPreventingSleep());

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  it('should return false when not preventing sleep', async () => {
    vi.mocked(keepAwakeService.isPreventingSleep).mockResolvedValue(false);
    vi.mocked(keepAwakeService.getRefCount).mockResolvedValue(0);
    vi.mocked(useExecutionStore).mockImplementation((selector) => {
      if (typeof selector === 'function') {
        return selector({ getRunningCount: () => 0 });
      }
      return {} as any;
    });

    const { result } = renderHook(() => useIsPreventingSleep());

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });
});
