// docs/app/share/layout.tsx
// Minimal layout for share pages (not using fumadocs)

import type { ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import './global.css';

export const metadata = {
  title: 'Shared Task | TalkCody',
  description: 'View a shared TalkCody task',
};

export default function ShareLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <div className="min-h-screen bg-white dark:bg-gray-950">
        {children}
      </div>
    </ThemeProvider>
  );
}
