import { parseExplorerSearch, type ExplorerSearch } from './event-query.js';

export interface SettingsSearch extends ExplorerSearch {
  readonly section: 'project' | 'members';
}
export function parseSettingsSearch(input: Record<string, unknown>): SettingsSearch {
  return {
    ...parseExplorerSearch(input),
    section: input.section === 'members' ? 'members' : 'project',
  };
}
export function settingsHref(search: SettingsSearch, section: SettingsSearch['section']): string {
  return `/settings?${new URLSearchParams({ ...(search.organization ? { organization: search.organization } : {}), project: search.project, environment: search.environment, range: search.range, source: search.source, section })}`;
}
