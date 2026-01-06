// docs/components/share/share-code-block.tsx
// Code block component for shared conversations

'use client';

import { Check, Copy } from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';

interface ShareCodeBlockProps {
  children: ReactNode;
  className?: string;
}

function ShareCodeBlockComponent({ children, className }: ShareCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  // Extract language from className (e.g., "language-typescript")
  const languageMatch = className?.match(/language-(\w+)/);
  const language = languageMatch ? languageMatch[1] : '';

  // Get the code text content
  const getCodeText = (node: ReactNode): string => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(getCodeText).join('');
    if (node && typeof node === 'object' && 'props' in node) {
      return getCodeText((node as { props?: { children?: ReactNode } }).props?.children);
    }
    return '';
  };

  const codeText = getCodeText(children);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  return (
    <div className="group relative my-4 overflow-hidden rounded-lg border border-gray-200/50 dark:border-gray-700/50">
      {/* Header with language and copy button */}
      <div className="flex items-center justify-between bg-gray-100/50 px-4 py-2 dark:bg-gray-800/50">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          type="button"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </button>
      </div>

      {/* Code content */}
      <pre className="overflow-x-auto px-4 bg-gray-50 dark:bg-gray-900">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

export const ShareCodeBlock = memo(ShareCodeBlockComponent);
