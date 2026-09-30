import type { FindingState } from './types';
import type { PanelState } from './ui/panel';
import type { ReviewProvider } from './review/providers';

export const PANEL_PORT = 'minaosi:panel';

export type PanelCommand =
  | { action: 'run' | 'settings' | 'back' | 'consent' | 'clearKey' }
  | { action: 'filter'; filter: FindingState }
  | { action: 'select'; id: string | null }
  | { action: 'apply' | 'delete' | 'revert'; id: string }
  | { action: 'saveKey' | 'saveModel'; value: string }
  | { action: 'saveProvider'; provider: ReviewProvider };

export interface PanelUpdate {
  type: 'state';
  state: PanelState | null;
}
