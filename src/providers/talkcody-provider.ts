// TalkCody provider - Free AI provider for TalkCody users
// Uses JWT token authentication (requires GitHub/Google login)

import { createAnthropic } from '@ai-sdk/anthropic';
import { API_BASE_URL } from '@/lib/config';
import { streamFetch } from '@/lib/tauri-fetch';
import { secureStorage } from '@/services/secure-storage';

/**
 * Create authenticated fetch function for TalkCody provider
 * Uses JWT token from user authentication
 */
function createAuthenticatedFetch(): (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response> {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Get JWT token from secure storage
    const token = await secureStorage.getAuthToken();

    if (!token) {
      throw new Error(
        'Authentication required. Please sign in with GitHub or Google to use TalkCody Free.'
      );
    }

    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);

    return streamFetch(input, {
      ...init,
      headers,
    });
  };
}

/**
 * Create TalkCody provider instance (synchronous)
 * Uses Anthropic protocol with JWT authentication
 */
export function createTalkCodyProvider(): ReturnType<typeof createAnthropic> {
  const baseURL = `${API_BASE_URL}/api/talkcody/v1`;

  return createAnthropic({
    apiKey: 'talkcody-internal', // Not used, auth is via JWT token
    baseURL,
    fetch: createAuthenticatedFetch() as typeof fetch,
  });
}

/**
 * Get TalkCody provider usage statistics
 */
export async function getTalkCodyUsage(): Promise<{
  date: string;
  used: { totalTokens: number; inputTokens: number; outputTokens: number; requestCount: number };
  limit: { dailyTokens: number };
  remaining: { dailyTokens: number };
}> {
  const token = await secureStorage.getAuthToken();

  if (!token) {
    throw new Error('Authentication required');
  }

  const response = await streamFetch(`${API_BASE_URL}/api/talkcody/usage`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get usage: ${response.status}`);
  }

  return response.json();
}

/**
 * Check if TalkCody provider is available
 * Requires user to be authenticated
 */
export async function isTalkCodyAvailable(): Promise<boolean> {
  const token = await secureStorage.getAuthToken();
  return token !== null && token.length > 0;
}

/**
 * Check if user is authenticated for TalkCody (synchronous check)
 * Returns cached result, call isTalkCodyAvailable() for async check
 *
 * Note: This function maintains a cache that is updated asynchronously.
 * The cache is initialized when the module loads, so it should be accurate
 * after the initial async operation completes.
 */
let cachedAuthStatus = false;
let cacheInitialized = false;

// Initialize cache on module load
function initAuthCache(): void {
  secureStorage.getAuthToken().then((token) => {
    cachedAuthStatus = token !== null && token.length > 0;
    cacheInitialized = true;
  });
}

// Start initialization immediately when module is loaded
initAuthCache();

export function isTalkCodyAvailableSync(): boolean {
  // If cache not yet initialized, trigger a refresh (but still return current cached value)
  if (!cacheInitialized) {
    initAuthCache();
  }
  return cachedAuthStatus;
}

/**
 * Update the cached auth status (call this after login/logout)
 */
export function updateTalkCodyAuthCache(isAuthenticated: boolean): void {
  cachedAuthStatus = isAuthenticated;
  cacheInitialized = true;
}
