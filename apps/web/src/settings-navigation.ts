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
