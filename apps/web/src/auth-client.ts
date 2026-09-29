import { z } from 'zod';

export const hostedConsole = import.meta.env.PROD;

export function apiReadHeaders(token: string): HeadersInit {
  return hostedConsole ? {} : { authorization: `Bearer ${token}` };
}

export async function fetchConsoleSession(): Promise<{
  readonly userId: string;
  readonly csrfToken: string;
}> {
  const response = await fetch('/v1/auth/session', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(response.status === 401 ? 'signed_out' : 'session_unavailable');
  return z.object({ userId: z.string(), csrfToken: z.string() }).parse(await response.json());
}

export async function logoutConsole(): Promise<void> {
  const session = await fetchConsoleSession();
  const response = await fetch('/v1/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-csrf-token': session.csrfToken },
  });
  if (!response.ok) throw new Error('Sign out failed. Please try again.');
  window.location.assign('/');
}
