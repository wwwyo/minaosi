import type { PanelState } from './ui/panel';

export const PANEL_PORT = 'minaosi:panel';

export interface TurnstileProof {
  /** 校閲サーバーへそのまま渡す Turnstile トークン。 */
  token?: string;
  /** トークン取得に失敗した理由。サーバーへ送らずに失敗を表示する。 */
  error?: string;
}

export type PanelCommand =
  | { action: 'run'; turnstile?: TurnstileProof }
  | { action: 'select'; id: string | null }
  | { action: 'apply' | 'delete' | 'revert'; id: string };

export interface PanelUpdate {
  type: 'state';
  state: PanelState | null;
}
