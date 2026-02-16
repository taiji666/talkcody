import { resolveResource } from '@tauri-apps/api/path';

const RESOURCE_PREFIX = '$RESOURCE/';
const RESOURCE_PREFIX_WINDOWS = '$RESOURCE\\';
const RESOURCE_PATTERN = /\$RESOURCE[/\\]([^\s"'";|&<>]+)/g;
const RESOURCE_DIR_PREFIX = 'resources/';

export function isResourcePath(path: string): boolean {
  return path.startsWith(RESOURCE_PREFIX) || path.startsWith(RESOURCE_PREFIX_WINDOWS);
}

export function normalizeResourcePath(resourcePath: string): string {
  return resourcePath.replace(/\\/g, '/');
}

export function stripResourcePrefix(path: string): string {
  if (path.startsWith(RESOURCE_PREFIX)) {
    return path.slice(RESOURCE_PREFIX.length);
  }
  if (path.startsWith(RESOURCE_PREFIX_WINDOWS)) {
    return path.slice(RESOURCE_PREFIX_WINDOWS.length);
  }
  return path;
}

function buildResourceCandidates(path: string): string[] {
  const normalizedPath = normalizeResourcePath(stripResourcePrefix(path));
  if (!normalizedPath) {
    return [normalizedPath];
  }
  if (normalizedPath.startsWith(RESOURCE_DIR_PREFIX)) {
    const withoutPrefix = normalizedPath.slice(RESOURCE_DIR_PREFIX.length);
    return [normalizedPath, withoutPrefix].filter(Boolean);
  }
  return [normalizedPath, `${RESOURCE_DIR_PREFIX}${normalizedPath}`];
}

export async function resolveResourcePath(path: string): Promise<string> {
  const candidates = buildResourceCandidates(path);
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      return await resolveResource(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('Failed to resolve resource path');
}

export async function replaceResourcePathsInCommand(command: string): Promise<string> {
  const matches = [...command.matchAll(RESOURCE_PATTERN)];

  if (matches.length === 0) {
    return command;
  }

  let result = '';
  let lastIndex = 0;

  for (const match of matches) {
    const fullMatch = match[0];
    const resourcePath = match[1] ?? '';
    const matchIndex = match.index ?? 0;

    result += command.slice(lastIndex, matchIndex);

    if (!resourcePath) {
      result += fullMatch;
    } else {
      try {
        const resolvedPath = await resolveResourcePath(resourcePath);
        result += resolvedPath;
      } catch {
        result += fullMatch;
      }
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  result += command.slice(lastIndex);

  return result;
}
