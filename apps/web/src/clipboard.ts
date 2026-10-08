export async function writeClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Clipboard access can be denied; retain the browser's local copy fallback.
  }
  const previousFocus = document.activeElement;
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
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }
}
