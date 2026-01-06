// Changelog data service for What's New dialog

export interface ChangelogContent {
  added?: string[];
  changed?: string[];
  fixed?: string[];
  removed?: string[];
  security?: string[];
  deprecated?: string[];
}

export interface ChangelogEntry {
  version: string;
  date: string;
  en: ChangelogContent;
  zh: ChangelogContent;
}

// Changelog data - update this when releasing new versions
// Only include the most recent versions that users care about
export const CHANGELOG_DATA: ChangelogEntry[] = [
  {
    version: '0.2.4',
    date: '2026-01-06',
    en: {
      added: [
        'Share Links: Support for generating exclusive links to share AI conversation tasks with others, with multiple expiration options and password protection.',
        'MiniMax Usage: Usage page now displays MiniMax Coding Plan usage.',
        'Free Web Search: New free Web Search without additional configuration.',
      ],
      changed: [
        'Plan Mode Optimization: Support for saving Plan results as files.',
        'Global File Search Enhancement: Added support for hidden files and directories, with path search support.',
        'Glob Tool Optimization: Support for searching hidden files and directories.',
      ],
      fixed: [
        'Fixed External File Modification Detection: Resolved inaccurate detection when files are modified externally.',
        'Fixed Keyboard Shortcut Conflict: Resolved Shift+Esc and Cmd+F keyboard shortcut conflict.',
        'Fixed Agent Tool Timeout Issue: Optimized call-agent-tool timeout handling mechanism.',
      ],
    },
    zh: {
      added: [
        '分享链接：支持将 AI 对话任务生成专属链接与他人分享，支持多种过期时间和密码保护',
        'MiniMax Usage：Usage 页面可以查看 MiniMax Coding Plan 用量',
        '免费的 Web Search：新增免费的 Web Search，无需额外配置',
      ],
      changed: [
        'Plan Mode 优化：支持将 Plan 结果保存为文件',
        '全局文件搜索改进：新增隐藏文件和目录支持，支持路径搜索',
        'glob tool 优化：支持隐藏文件和目录的搜索',
      ],
      fixed: [
        '修复文件外部修改检测问题：解决文件被外部修改时检测不准确的问题',
        '修复快捷键冲突：解决 Shift+Esc 和 Cmd+F 快捷键冲突问题',
        '修复 Agent 工具超时问题：优化 call-agent-tool 的超时处理机制',
      ],
    },
  },
];

export function getChangelogForVersion(version: string): ChangelogEntry | undefined {
  return CHANGELOG_DATA.find((entry) => entry.version === version);
}

export function getLatestChangelog(): ChangelogEntry | undefined {
  return CHANGELOG_DATA[0];
}
