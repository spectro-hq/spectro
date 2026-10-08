import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeClipboard } from './clipboard.js';

afterEach(() => vi.unstubAllGlobals());

describe('read-only reference copy', () => {
  it('copies exactly the provided text using the platform API', async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await writeClipboard('{"safe":true}')).toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('{"safe":true}');
  });
  it.each([true, false])(
    'falls back locally and returns the actual copy result: %s',
    async (success) => {
      const writeText = vi
        .fn<(value: string) => Promise<void>>()
        .mockRejectedValue(new Error('Denied'));
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      class FocusElement {
        focus = vi.fn<() => void>();
      }
      vi.stubGlobal('HTMLElement', FocusElement);
      const previousFocus = new FocusElement();
      const textarea = {
        value: '',
        setAttribute: vi.fn<(name: string, value: string) => void>(),
        style: {},
        select: vi.fn<() => void>(),
        remove: vi.fn<() => void>(),
      };
      const execCommand = vi.fn<(command: string) => boolean>().mockReturnValue(success);
      vi.stubGlobal('document', {
        activeElement: previousFocus,
        createElement: vi.fn<() => typeof textarea>().mockReturnValue(textarea),
        body: { append: vi.fn<(element: unknown) => void>() },
        execCommand,
      });
      expect(await writeClipboard('safe schema')).toBe(success);
      expect(textarea.value).toBe('safe schema');
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(textarea.remove).toHaveBeenCalledOnce();
      expect(previousFocus.focus).toHaveBeenCalledOnce();
    },
  );
  it('returns failure and cleans up when the legacy copy mechanism throws', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal(
      'HTMLElement',
      class FocusElement {
        focus(): void {}
      },
    );
    const remove = vi.fn<() => void>();
    vi.stubGlobal('document', {
      activeElement: null,
      createElement: () => ({
        setAttribute: vi.fn<(name: string, value: string) => void>(),
        style: {},
        select: vi.fn<() => void>(),
        remove,
      }),
      body: { append: vi.fn<(element: unknown) => void>() },
      execCommand: () => {
        throw new Error('Unavailable');
      },
    });
    expect(await writeClipboard('safe schema')).toBe(false);
    expect(remove).toHaveBeenCalledOnce();
  });
});
