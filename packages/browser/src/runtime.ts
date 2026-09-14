export interface RawPageSnapshot {
  href: string;
  title: string;
  referrer: string;
}

export interface BrowserLifecycleRuntime {
  readPage(): RawPageSnapshot;
  readSessionItem(key: string): string | null;
  writeSessionItem(key: string, value: string): void;
  subscribeToNavigation(listener: () => void): () => void;
  subscribeToActivity(listener: () => void): () => void;
}

export function createBrowserLifecycleRuntime(): BrowserLifecycleRuntime | undefined {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return undefined;
  }

  return {
    readPage() {
      return {
        href: window.location.href,
        title: document.title,
        referrer: document.referrer,
      };
    },
    readSessionItem(key) {
      return window.sessionStorage.getItem(key);
    },
    writeSessionItem(key, value) {
      window.sessionStorage.setItem(key, value);
    },
    subscribeToNavigation(listener) {
      const originalPushState = window.history.pushState;
      const originalReplaceState = window.history.replaceState;
      const wrappedPushState: History['pushState'] = function (data, unused, url) {
        originalPushState.call(window.history, data, unused, url);
        listener();
      };
      const wrappedReplaceState: History['replaceState'] = function (data, unused, url) {
        originalReplaceState.call(window.history, data, unused, url);
        listener();
      };
      window.history.pushState = wrappedPushState;
      window.history.replaceState = wrappedReplaceState;
      window.addEventListener('popstate', listener);
      window.addEventListener('hashchange', listener);

      return () => {
        window.removeEventListener('popstate', listener);
        window.removeEventListener('hashchange', listener);
        if (window.history.pushState === wrappedPushState) {
          window.history.pushState = originalPushState;
        }
        if (window.history.replaceState === wrappedReplaceState) {
          window.history.replaceState = originalReplaceState;
        }
      };
    },
    subscribeToActivity(listener) {
      const options: AddEventListenerOptions = { capture: true, passive: true };
      window.addEventListener('pointerdown', listener, options);
      window.addEventListener('keydown', listener, options);
      window.addEventListener('scroll', listener, options);
      document.addEventListener('visibilitychange', listener, options);

      return () => {
        window.removeEventListener('pointerdown', listener, true);
        window.removeEventListener('keydown', listener, true);
        window.removeEventListener('scroll', listener, true);
        document.removeEventListener('visibilitychange', listener, true);
      };
    },
  };
}
