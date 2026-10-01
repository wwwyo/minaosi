import { PANEL_PORT, type PanelCommand, type PanelUpdate } from './panel-messages';

export class PanelConnection {
  private port: Browser.runtime.Port | null = null;
  private tabId: number | undefined;
  private generation = 0;

  constructor(
    private openPort: (tabId: number, name: string) => Browser.runtime.Port,
    private onState: (state: PanelUpdate['state']) => void,
    private consumeError: () => void,
  ) {}

  get activeTabId() { return this.tabId; }

  send(command: PanelCommand) { this.port?.postMessage(command); }

  connectToTab(tabId: number | undefined) {
    const generation = ++this.generation;
    this.port?.disconnect();
    this.port = null;
    this.tabId = tabId;
    this.onState(null);
    if (tabId === undefined) return;

    const port = this.openPort(tabId, PANEL_PORT);
    this.port = port;
    port.onMessage.addListener((update: PanelUpdate) => {
      if (generation !== this.generation || update.type !== 'state') return;
      this.onState(update.state);
    });
    port.onDisconnect.addListener(() => {
      this.consumeError();
      if (generation !== this.generation) return;
      this.port = null;
      this.onState(null);
    });
  }

  /** document_idle が complete より遅れるため、complete の通知だけには依存しない。 */
  contentReady(tabId: number | undefined) {
    if (tabId !== undefined && tabId === this.tabId) this.connectToTab(tabId);
  }

  dispose() {
    ++this.generation;
    this.tabId = undefined;
    this.port?.disconnect();
    this.port = null;
  }
}
