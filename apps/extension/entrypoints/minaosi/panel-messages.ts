import type { PanelState } from './ui/panel';
import type { ReviewTrigger } from './surfaces/types';

export const PANEL_PORT = 'minaosi:panel';

export interface TurnstileProof {
  /** 校閲サーバーへそのまま渡す Turnstile トークン。 */
  token?: string;
  /** トークン取得に失敗した理由。サーバーへ送らずに失敗を表示する。 */
  error?: string;
}

export type PanelCommand =
  | { action: 'run'; trigger: ReviewTrigger; editorId: string; turnstile?: TurnstileProof }
  | { action: 'select'; id: string | null }
  | { action: 'apply' | 'delete' | 'revert'; id: string };

export interface PanelUpdate {
  type: 'state';
  state: PanelState | null;
}
