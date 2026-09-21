import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import { SpectroIcon } from './spectro-icons.js';

export type PayloadFormat = 'json' | 'yaml';

function isPayloadFormat(value: string): value is PayloadFormat {
  return value === 'json' || value === 'yaml';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function yamlScalar(value: unknown): string | undefined {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function yamlLines(value: unknown, depth = 0): string[] {
  const indentation = '  '.repeat(depth);
  const scalar = yamlScalar(value);
  if (scalar !== undefined) return [`${indentation}${scalar}`];

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indentation}[]`];
    return value.flatMap((item) => {
      const itemScalar = yamlScalar(item);
      if (itemScalar !== undefined) return [`${indentation}- ${itemScalar}`];
      return [`${indentation}-`, ...yamlLines(item, depth + 1)];
    });
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return [`${indentation}{}`];
    return entries.flatMap(([key, item]) => {
      const encodedKey = JSON.stringify(key);
      const itemScalar = yamlScalar(item);
      if (itemScalar !== undefined) return [`${indentation}${encodedKey}: ${itemScalar}`];
      return [`${indentation}${encodedKey}:`, ...yamlLines(item, depth + 1)];
    });
  }

  return [`${indentation}${JSON.stringify(String(value))}`];
}

export function formatPayload(value: unknown, format: PayloadFormat): string {
  if (format === 'yaml') return yamlLines(value).join('\n');
  return JSON.stringify(value, null, 2) ?? 'null';
}

const syntaxTokenPattern =
  /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;

function highlightedLine(line: string): ReactNode[] {
  const fragments: ReactNode[] = [];
  let cursor = 0;

  for (const match of line.matchAll(syntaxTokenPattern)) {
    const token = match[0];
    const index = match.index;
    if (index > cursor) fragments.push(line.slice(cursor, index));

    let tokenKind = 'number';
    if (token.startsWith('"')) {
      tokenKind = line
        .slice(index + token.length)
        .trimStart()
        .startsWith(':')
        ? 'key'
        : 'string';
    } else if (token === 'true' || token === 'false') {
      tokenKind = 'boolean';
    } else if (token === 'null') {
      tokenKind = 'null';
    }

    fragments.push(
      <span className={`syntax-${tokenKind}`} key={`${index}-${tokenKind}`}>
        {token}
      </span>,
    );
    cursor = index + token.length;
  }

  if (cursor < line.length) fragments.push(line.slice(cursor));
  return fragments;
}

async function writeClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Continue to the local fallback when Clipboard API access is unavailable.
  }

  const textarea = document.createElement('textarea');
  try {
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export function PayloadViewer({ value }: { readonly value: unknown }): ReactElement {
  const [format, setFormat] = useState<PayloadFormat>('json');
  const [copied, setCopied] = useState(false);
  const formatted = useMemo(() => formatPayload(value, format), [format, value]);
  const lines = formatted.split('\n');

  useEffect(() => {
    if (!copied) return undefined;
    const timeout = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  return (
    <section className="payload-section">
      <header className="payload-toolbar">
        <h3>Event payload</h3>
        <div className="payload-actions">
          <label>
            <span className="sr-only">Payload format</span>
            <select
              aria-label="Payload format"
              value={format}
              onChange={(event) => {
                const nextFormat = event.currentTarget.value;
                if (isPayloadFormat(nextFormat)) setFormat(nextFormat);
              }}
            >
              <option value="json">JSON</option>
              <option value="yaml">YAML</option>
            </select>
          </label>
          <button
            className={copied ? 'copied' : undefined}
            type="button"
            onClick={() => void writeClipboard(formatted).then(setCopied)}
          >
            <SpectroIcon name={copied ? 'check' : 'copy'} size={16} />
            <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </header>
      <div className="payload-code-scroll">
        <ol className="payload-code" aria-label={`Event payload in ${format.toUpperCase()}`}>
          {lines.map((line, index) => (
            <li key={`${index}-${line}`}>
              <code>{highlightedLine(line)}</code>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
