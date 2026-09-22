import { useEffect, useState } from 'react';

import { SpectroIcon } from './spectro-icons.js';

type ColorTheme = 'light' | 'dark';

function initialColorTheme(): ColorTheme {
  const documentTheme = document.documentElement.dataset.theme;
  if (documentTheme === 'light' || documentTheme === 'dark') return documentTheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ColorTheme>(initialColorTheme);
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#0e1420' : '#f5f5f7');
  }, [theme]);

  const toggleTheme = (): void => {
    setTheme(nextTheme);
    try {
      localStorage.setItem('spectro.color-theme', nextTheme);
    } catch {
      // Theme selection still works for this session when storage is unavailable.
    }
  };

  return (
    <button
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={theme === 'dark'}
      className="theme-toggle"
      title={`Switch to ${nextTheme} mode`}
      type="button"
      onClick={toggleTheme}
    >
      <SpectroIcon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
    </button>
  );
}

export function CommittedInput({
  ariaLabel,
  id,
  onCommit,
  pattern,
  placeholder,
  title,
  validate,
  value,
}: {
  readonly ariaLabel: string;
  readonly id: string;
  readonly onCommit: (value: string) => void;
  readonly pattern?: string;
  readonly placeholder?: string;
  readonly title?: string;
  readonly validate: (value: string) => boolean;
  readonly value: string;
}) {
  const [draft, setDraft] = useState(value);
  const valid = validate(draft);

  const commit = (): void => {
    if (valid && draft !== value) onCommit(draft);
  };

  return (
    <input
      aria-invalid={!valid}
      aria-label={ariaLabel}
      id={id}
      pattern={pattern}
      placeholder={placeholder}
      spellCheck="false"
      title={title}
      value={draft}
      onBlur={commit}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

export function readSessionToken(): string {
  try {
    return sessionStorage.getItem('spectro.local-api-token') ?? '';
  } catch {
    return '';
  }
}

export function writeSessionToken(token: string): void {
  try {
    if (token.length > 0) sessionStorage.setItem('spectro.local-api-token', token);
    else sessionStorage.removeItem('spectro.local-api-token');
  } catch {
    // The token remains in React memory when session storage is unavailable.
  }
}
