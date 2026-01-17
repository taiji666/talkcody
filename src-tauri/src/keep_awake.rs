// keep_awake.rs - Keep awake service for preventing system sleep during task execution
//
// This module provides reference-counted sleep prevention to handle concurrent tasks:
// - Multiple tasks can request sleep prevention
// - Sleep is prevented while any task is active
// - Sleep is allowed when all tasks complete (refcount reaches 0)

use std::sync::Mutex;
use tauri::State;

/// State wrapper for keep awake functionality
pub struct KeepAwakeStateWrapper {
    state: KeepAwakeState,
}

impl KeepAwakeStateWrapper {
    pub fn new() -> Self {
        Self {
            state: KeepAwakeState::new(),
        }
    }

    pub fn inner(&self) -> &KeepAwakeState {
        &self.state
    }
}

impl Default for KeepAwakeStateWrapper {
    fn default() -> Self {
        Self::new()
    }
}

/// AppState re-export for lib.rs
pub type AppStateKeepAwake = KeepAwakeStateWrapper;

/// Keep awake state with reference counting
///
/// Thread-safe reference counter for managing sleep prevention requests.
/// Only allows sleep when the reference count reaches zero.
#[derive(Debug)]
pub struct KeepAwakeState {
    /// Number of active sleep prevention requests
    ref_count: Mutex<u32>,
}

impl KeepAwakeState {
    /// Create a new KeepAwakeState
    pub fn new() -> Self {
        Self {
            ref_count: Mutex::new(0),
        }
    }

    /// Acquire sleep prevention (increment reference count)
    ///
    /// Returns true if this was the first request (sleep prevention was just enabled)
    /// Returns false if sleep prevention was already active
    pub fn acquire(&self) -> bool {
        let mut count = self.ref_count.lock().expect("KeepAwakeState lock poisoned");
        *count += 1;
        let was_first = *count == 1;
        log::info!(
            "KeepAwake: acquire - ref_count = {} (first request: {})",
            *count,
            was_first
        );
        was_first
    }

    /// Release sleep prevention (decrement reference count)
    ///
    /// Returns true if this was the last release (sleep prevention can now be disabled)
    /// Returns false if other tasks are still active
    ///
    /// Note: This function does not allow ref_count to go below zero.
    /// Calling release when ref_count is 0 will return false and log a warning.
    pub fn release(&self) -> bool {
        let mut count = self.ref_count.lock().expect("KeepAwakeState lock poisoned");
        if *count == 0 {
            log::warn!("KeepAwake: release called when ref_count is already 0");
            return false;
        }
        *count -= 1;
        let was_last = *count == 0;
        log::info!(
            "KeepAwake: release - ref_count = {} (last request: {})",
            *count,
            was_last
        );
        was_last
    }

    /// Get current reference count
    pub fn ref_count(&self) -> u32 {
        *self.ref_count.lock().expect("KeepAwakeState lock poisoned")
    }

    /// Check if sleep is currently being prevented
    pub fn is_preventing_sleep(&self) -> bool {
        self.ref_count() > 0
    }
}

impl Default for KeepAwakeState {
    fn default() -> Self {
        Self::new()
    }
}

/// Tauri command to acquire sleep prevention
///
/// This command is called when a task starts and needs to prevent system sleep.
/// Returns true if sleep prevention was just enabled (first request).
/// Returns false if sleep prevention was already active.
#[tauri::command]
pub fn keep_awake_acquire(state: State<KeepAwakeStateWrapper>) -> Result<bool, String> {
    log::info!("keep_awake_acquire called");
    Ok(state.inner().acquire())
}

/// Tauri command to release sleep prevention
///
/// This command is called when a task completes and no longer needs to prevent system sleep.
/// Returns true if sleep prevention can now be disabled (last release).
/// Returns false if other tasks are still active.
#[tauri::command]
pub fn keep_awake_release(state: State<KeepAwakeStateWrapper>) -> Result<bool, String> {
    log::info!("keep_awake_release called");
    Ok(state.inner().release())
}

/// Get current reference count (for debugging)
#[tauri::command]
pub fn keep_awake_get_ref_count(state: State<KeepAwakeStateWrapper>) -> Result<u32, String> {
    Ok(state.inner().ref_count())
}

/// Check if sleep is currently being prevented
#[tauri::command]
pub fn keep_awake_is_preventing(state: State<KeepAwakeStateWrapper>) -> Result<bool, String> {
    Ok(state.inner().is_preventing_sleep())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_acquire_first_request() {
        let state = KeepAwakeState::new();
        assert!(state.acquire());
        assert_eq!(state.ref_count(), 1);
    }

    #[test]
    fn test_acquire_multiple_requests() {
        let state = KeepAwakeState::new();
        assert!(state.acquire()); // First request
        assert!(!state.acquire()); // Second request
        assert!(!state.acquire()); // Third request
        assert_eq!(state.ref_count(), 3);
    }

    #[test]
    fn test_release_last_request() {
        let state = KeepAwakeState::new();
        state.acquire();
        state.acquire();
        assert!(!state.release()); // Release second request
        assert!(state.release()); // Release last request
        assert_eq!(state.ref_count(), 0);
    }

    #[test]
    fn test_release_when_empty() {
        let state = KeepAwakeState::new();
        // Try to release when no requests exist
        assert!(!state.release());
        assert_eq!(state.ref_count(), 0);
    }

    #[test]
    fn test_is_preventing_sleep() {
        let state = KeepAwakeState::new();
        assert!(!state.is_preventing_sleep());
        state.acquire();
        assert!(state.is_preventing_sleep());
        state.release();
        assert!(!state.is_preventing_sleep());
    }

    #[test]
    fn test_concurrent_acquires() {
        use std::sync::Arc;
        let state = Arc::new(KeepAwakeState::new());
        let mut handles = vec![];

        for _ in 0..10 {
            let state_clone = Arc::clone(&state);
            let handle = std::thread::spawn(move || {
                state_clone.acquire();
                state_clone.ref_count()
            });
            handles.push(handle);
        }

        let counts: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();

        // All acquires should have succeeded
        assert!(counts.iter().all(|&c| c >= 1));
        assert_eq!(state.ref_count(), 10);
    }
}
