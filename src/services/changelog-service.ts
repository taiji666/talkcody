export type ChangelogItem =
  | string
  | {
      title: string;
      description?: string;
      videoUrl?: string;
    };

export interface ChangelogContent {
  added?: ChangelogItem[];
  changed?: ChangelogItem[];
  fixed?: ChangelogItem[];
  removed?: ChangelogItem[];
  security?: ChangelogItem[];
  deprecated?: ChangelogItem[];
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
    version: '0.4.4',
    date: '2026-02-26',
    en: {
      added: [
        'Aliyun Coding Plan Support: Aliyun Coding Plan supports Qwen 3.5 Plus, GLM-5, Kimi K2.5, and Minimax 2.5 models.',
        'New Nano Banana 2 Model: Added Nano Banana 2 model support.',
        'New GPT-5.3-Codex API Model: Added GPT-5.3-Codex API model support.',
      ],
      changed: ['Major web-fetch tool optimization.'],
    },
    zh: {
      added: [
        '阿里云 Coding Plan 支持：阿里云 Coding Plan 支持 Qwen 3.5 Plus，GLM-5, Kimi K2.5, Minimax 2.5 模型。',
        '新增 Nano Banana 2 模型。',
        '新增 GPT-5.3-Codex API 模型。',
      ],
      changed: ['大幅优化 web-fetch tool。'],
    },
  },
];

export function getChangelogForVersion(version: string): ChangelogEntry | undefined {
  return CHANGELOG_DATA.find((entry) => entry.version === version);
}

export function getLatestChangelog(): ChangelogEntry | undefined {
  return CHANGELOG_DATA[0];
}
