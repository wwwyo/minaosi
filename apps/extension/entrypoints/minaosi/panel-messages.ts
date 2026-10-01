import type { PanelFilter, PanelState } from './ui/panel';

export const PANEL_PORT = 'minaosi:panel';

export type PanelCommand =
  | { action: 'run' }
  | { action: 'filter'; filter: PanelFilter }
  | { action: 'select'; id: string | null }
  | { action: 'apply' | 'delete' | 'revert'; id: string };

export interface PanelUpdate {
  type: 'state';
  state: PanelState | null;
}
