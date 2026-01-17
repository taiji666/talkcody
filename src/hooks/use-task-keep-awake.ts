// use-task-keep-awake.ts - React hook for automatic sleep prevention during task execution
//
// This hook automatically manages sleep prevention based on task execution state:
// - Acquires sleep prevention when tasks start running
// - Releases sleep prevention when all tasks complete
// - Handles concurrent tasks gracefully with reference counting

import { useEffect, useRef, useState } from 'react';
import { logger } from '@/lib/logger';
import { keepAwakeService } from '@/services/keep-awake-service';
import { useExecutionStore } from '@/stores/execution-store';

/**
 * Hook for automatic sleep prevention during task execution
 *
 * This hook monitors the execution store and automatically prevents system sleep
 * when tasks are running. It uses reference counting to handle concurrent tasks.
 *
 * @returns Object containing sleep prevention status
 */
export function useTaskKeepAwake() {
  const [isPreventing, setIsPreventing] = useState(false);
  const [refCount, setRefCount] = useState(0);
  const runningCount = useExecutionStore((state) => state.getRunningCount());
  const previousRunningCountRef = useRef(0);
  const isInitializedRef = useRef(false);
  const isPreventingRef = useRef(false);

  // Sync with keep-awake service state
  useEffect(() => {
    const syncState = async () => {
      try {
        const [preventing, count] = await Promise.all([
          keepAwakeService.isPreventingSleep(),
          keepAwakeService.getRefCount(),
        ]);
        setIsPreventing(preventing);
        setRefCount(count);
        isPreventingRef.current = preventing;
        isInitializedRef.current = true;
      } catch (error) {
        logger.error('[useTaskKeepAwake] Failed to sync state:', error);
      }
    };

    syncState();
  }, []);

  // Handle running count changes
  useEffect(() => {
    // Don't handle changes before initialization
    if (!isInitializedRef.current) {
      return;
    }

    const previousRunningCount = previousRunningCountRef.current;
    const currentRunningCount = runningCount;

    logger.debug('[useTaskKeepAwake] Running count changed', {
      previous: previousRunningCount,
      current: currentRunningCount,
    });

    // Handle transition from 0 to 1 (first task started)
    if (previousRunningCount === 0 && currentRunningCount > 0) {
      logger.info('[useTaskKeepAwake] First task started, acquiring sleep prevention');
      keepAwakeService
        .acquire()
        .then((wasFirst) => {
          logger.info('[useTaskKeepAwake] Sleep prevention acquired', { wasFirst });
          if (wasFirst) {
            setIsPreventing(true);
            isPreventingRef.current = true;
          }
          // Update ref count
          return keepAwakeService.getRefCount();
        })
        .then((count) => {
          setRefCount(count);
        })
        .catch((error) => {
          logger.error('[useTaskKeepAwake] Failed to acquire sleep prevention:', error);
        });
    }
    // Handle transition from 1 to 0 (last task completed)
    else if (previousRunningCount > 0 && currentRunningCount === 0) {
      logger.info('[useTaskKeepAwake] All tasks completed, releasing sleep prevention');
      keepAwakeService
        .release()
        .then((wasLast) => {
          logger.info('[useTaskKeepAwake] Sleep prevention released', { wasLast });
          if (wasLast) {
            setIsPreventing(false);
            isPreventingRef.current = false;
          }
          // Update ref count
          return keepAwakeService.getRefCount();
        })
        .then((count) => {
          setRefCount(count);
        })
        .catch((error) => {
          logger.error('[useTaskKeepAwake] Failed to release sleep prevention:', error);
        });
    }
    // Handle concurrent task changes
    else if (currentRunningCount > 0 && previousRunningCount > 0) {
      // Tasks are still running, just log the change
      logger.debug('[useTaskKeepAwake] Concurrent tasks, count changed', {
        previous: previousRunningCount,
        current: currentRunningCount,
      });
    }

    // Update previous running count ref
    previousRunningCountRef.current = currentRunningCount;
  }, [runningCount]);

  // Cleanup on unmount - release all sleep prevention
  useEffect(() => {
    return () => {
      if (isPreventingRef.current) {
        logger.info('[useTaskKeepAwake] Cleaning up sleep prevention on unmount');
        keepAwakeService
          .forceReleaseAll()
          .then(() => {
            setIsPreventing(false);
            setRefCount(0);
            isPreventingRef.current = false;
          })
          .catch((error) => {
            logger.error('[useTaskKeepAwake] Failed to force release:', error);
          });
      }
    };
  }, []);

  return {
    isPreventing,
    refCount,
    runningCount,
  };
}

/**
 * Simpler hook that just returns sleep prevention status
 * Use this if you don't need detailed counts
 */
export function useIsPreventingSleep(): boolean {
  const { isPreventing } = useTaskKeepAwake();
  return isPreventing;
}
