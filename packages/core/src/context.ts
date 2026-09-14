import type { EventContext } from '@spectro/protocol';
import type { SpectroClientOptions } from '@spectro/types';

import { normalizeProperties, normalizeTags } from './normalize.js';

export function createEventContext(options: SpectroClientOptions): EventContext {
  const context: EventContext = {
    sdk: options.sdk ?? { name: '@spectro/browser', version: '0.1.0' },
    project: { id: options.projectId },
    environment: options.environment,
  };

  if (options.session) context.session = options.session;
  if (options.user) {
    context.user = options.user.traits
      ? { ...options.user, traits: normalizeProperties(options.user.traits) }
      : options.user;
  }
  if (options.page) context.page = options.page;
  if (options.device) context.device = options.device;
  if (options.browser) context.browser = options.browser;
  if (options.os) context.os = options.os;
  if (options.trace) context.trace = options.trace;
  if (options.tags) context.tags = normalizeTags(options.tags);
  if (options.release) context.release = { version: options.release };

  return context;
}
