import { createContext, useContext } from 'react';

import type { OrganizationSummary, ProjectSummary } from './workspace-client.js';

export interface WorkspaceSnapshot {
  readonly organizations: readonly OrganizationSummary[];
  readonly projects: readonly ProjectSummary[];
}

export const WorkspaceContext = createContext<WorkspaceSnapshot | undefined>(undefined);

export function useWorkspace(): WorkspaceSnapshot | undefined {
  return useContext(WorkspaceContext);
}
