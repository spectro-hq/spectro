import { writeClipboard } from '../clipboard.js';

const COPY_FAILURE = 'Copy is unavailable. Select the code above and copy it manually.';
const COPY_SUCCESS = 'Code copied. Replace the example values with your project settings.';

/** The page, including its native radio demo and FAQ, works before enhancement. */
export function enhanceLanding(
  root: ParentNode,
  copy: (value: string) => Promise<boolean> = writeClipboard,
): () => void {
  const cleanups = [
    enhanceCopyControls(root, copy),
    observeTraceNodes(root),
    trackHeaderScroll(root),
  ];
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

/**
 * Every `button[data-copy]` copies the plain text of the element named by
 * `data-copy-target`. Buttons stay hidden without JavaScript; a single shared
 * status region reports the result.
 */
function enhanceCopyControls(
  root: ParentNode,
  copy: (value: string) => Promise<boolean>,
): () => void {
  const buttons = Array.from(
    root.querySelectorAll<HTMLButtonElement>('button[data-copy][data-copy-target]'),
  );
  const status = root.querySelector<HTMLElement>('[data-copy-status]');
  if (buttons.length === 0 || status === null) return () => {};
  let active = true;
  const disposers: Array<() => void> = [];

  for (const button of buttons) {
    const targetId = button.dataset.copyTarget;
    const target = targetId ? root.querySelector<HTMLElement>(`#${targetId}`) : null;
    if (target === null) continue;
    let pending = false;
    button.hidden = false;

    const onCopy = async (): Promise<void> => {
      if (pending) return;
      pending = true;
      button.disabled = true;
      let copied = false;
      try {
        copied = await copy(target.textContent ?? '');
      } catch {
        // Clipboard permission failures must leave the readable example available.
      } finally {
        if (active) {
          status.textContent = copied ? (button.dataset.copySuccess ?? COPY_SUCCESS) : COPY_FAILURE;
          button.disabled = false;
        }
        pending = false;
      }
    };

    button.addEventListener('click', onCopy);
    disposers.push(() => {
      button.removeEventListener('click', onCopy);
      button.hidden = true;
    });
  }

  return () => {
    active = false;
    for (const dispose of disposers) dispose();
  };
}

// Percentage rootMargins resolve against the root rectangle's width per
// spec, which would collapse this vertical band on wide viewports; derive
// pixel margins from the viewport height and rebuild on resize.
function bandMargin(): string {
  const height = typeof window === 'undefined' ? 800 : window.innerHeight;
  return `-${Math.round(height * 0.38)}px 0px -${Math.round(height * 0.55)}px 0px`;
}

/**
 * Marks the section whose trace marker is currently centered on the spine and
 * mirrors that position onto the matching header navigation link.
 * Purely additive: spine and links are complete without it and nothing
 * animates under reduced motion.
 */
function observeTraceNodes(root: ParentNode): () => void {
  if (typeof IntersectionObserver !== 'function') return () => {};
  const sections = new Set<HTMLElement>();
  for (const marker of root.querySelectorAll('.trace-marker')) {
    const section = marker.closest('section');
    if (section instanceof HTMLElement) sections.add(section);
  }
  if (sections.size === 0) return () => {};

  const navLinks = new Map<string, HTMLAnchorElement>();
  for (const link of root.querySelectorAll<HTMLAnchorElement>('.site-header nav a[href^="#"]')) {
    const id = link.getAttribute('href')?.slice(1) ?? '';
    if (id.length > 0) navLinks.set(id, link);
  }

  const onIntersect = (entries: IntersectionObserverEntry[]): void => {
    for (const entry of entries) {
      entry.target.classList.toggle('is-active', entry.isIntersecting);
      if (entry.isIntersecting) {
        for (const link of navLinks.values()) link.removeAttribute('aria-current');
        navLinks.get(entry.target.id)?.setAttribute('aria-current', 'location');
      } else {
        navLinks.get(entry.target.id)?.removeAttribute('aria-current');
      }
    }
  };
  let observer: IntersectionObserver | undefined;
  const activate = (): void => {
    observer = new IntersectionObserver(onIntersect, { rootMargin: bandMargin() });
    for (const section of sections) observer.observe(section);
  };
  let resizeQueued = false;
  const rebuild = (): void => {
    resizeQueued = false;
    observer?.disconnect();
    activate();
  };
  const onResize = (): void => {
    if (resizeQueued) return;
    resizeQueued = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(rebuild);
    else rebuild();
  };
  activate();
  if (typeof window !== 'undefined') window.addEventListener('resize', onResize);
  return () => {
    if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
    observer?.disconnect();
    for (const section of sections) section.classList.remove('is-active');
    for (const link of navLinks.values()) link.removeAttribute('aria-current');
  };
}

/**
 * Keeps the fixed header quiet over the hero: a hairline and lift appear only
 * once the visitor has actually scrolled past the top.
 */
function trackHeaderScroll(root: ParentNode): () => void {
  const header = root.querySelector<HTMLElement>('.site-header');
  if (header === null || typeof window === 'undefined') return () => {};
  const onScroll = (): void => {
    header.classList.toggle('is-scrolled', window.scrollY > 8);
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    window.removeEventListener('scroll', onScroll);
    header.classList.remove('is-scrolled');
  };
}
