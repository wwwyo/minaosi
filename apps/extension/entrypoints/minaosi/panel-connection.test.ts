import { describe, expect, test } from 'bun:test';
import { PanelConnection } from './panel-connection';
import { PANEL_PORT, type PanelCommand, type PanelUpdate } from './panel-messages';

function event<T extends unknown[]>() {
  const listeners: ((...args: T) => void)[] = [];
  return {
    addListener: (listener: (...args: T) => void) => { listeners.push(listener); },
    emit: (...args: T) => { for (const listener of listeners) listener(...args); },
  };
}

function fixture() {
  const ports: ReturnType<typeof createPort>[] = [];
  const states: PanelUpdate['state'][] = [];
  const opened: { tabId: number; name: string }[] = [];
  let errorsConsumed = 0;
  function createPort() {
    const onMessage = event<[PanelUpdate]>();
    const onDisconnect = event<[]>();
    const sent: PanelCommand[] = [];
    return { onMessage, onDisconnect, sent, disconnect: () => onDisconnect.emit(), postMessage: (command: PanelCommand) => sent.push(command) };
  }
  const connection = new PanelConnection(
    (tabId, name) => {
      opened.push({ tabId, name });
      const port = createPort();
      ports.push(port);
      return port as unknown as Browser.runtime.Port;
    },
    (state) => states.push(state),
    () => { errorsConsumed++; },
  );
  return { connection, ports, states, opened, errorsConsumed: () => errorsConsumed };
}

const readyState: NonNullable<PanelUpdate['state']> = {
  phase: 'idle', view: 'list', filter: 'open', selectedId: null,
  findings: [], connectionLoading: false,
};

describe('PanelConnection', () => {
  test.each([false, true])('先行接続した pane は準備完了後に初期 state を受け取る（先行 port 切断: %s）', (disconnected) => {
    const { connection, ports, states, opened } = fixture();
    connection.connectToTab(7);
    if (disconnected) ports[0]!.onDisconnect.emit();
    connection.contentReady(7);
    ports[1]!.onMessage.emit({ type: 'state', state: readyState });
    expect(opened).toEqual([{ tabId: 7, name: PANEL_PORT }, { tabId: 7, name: PANEL_PORT }]);
    expect(states.at(-1)).toEqual(readyState);
    connection.send({ action: 'run' });
    expect(ports[1]!.sent).toEqual([{ action: 'run' }]);
  });

  test('エディタの遅延描画による null state からの更新は接続を維持して受け取る', () => {
    const { connection, ports, states, opened } = fixture();
    connection.connectToTab(7);
    ports[0]!.onMessage.emit({ type: 'state', state: null });
    ports[0]!.onMessage.emit({ type: 'state', state: readyState });
    expect(states).toEqual([null, null, readyState]);
    expect(opened).toHaveLength(1);
  });

  test('別タブやタブ情報のない準備完了通知では再接続しない', () => {
    const { connection, opened } = fixture();
    connection.connectToTab(7);
    connection.contentReady(8);
    connection.contentReady(undefined);
    expect(opened).toHaveLength(1);
  });

  test('タブ切り替え後の古い state と切断通知は現在の表示と送信先を変えない', () => {
    const { connection, ports, states, errorsConsumed } = fixture();
    connection.connectToTab(7);
    connection.connectToTab(8);
    ports[1]!.onMessage.emit({ type: 'state', state: readyState });
    ports[0]!.onMessage.emit({ type: 'state', state: null });
    ports[0]!.onDisconnect.emit();
    expect(states.at(-1)).toEqual(readyState);
    expect(errorsConsumed()).toBe(2);
    expect(connection.activeTabId).toBe(8);
    connection.send({ action: 'run' });
    expect(ports[0]!.sent).toEqual([]);
    expect(ports[1]!.sent).toEqual([{ action: 'run' }]);
  });

  test('pane 終了後の通知と操作では再接続も state 更新も送信もしない', () => {
    const { connection, ports, states, opened } = fixture();
    connection.connectToTab(7);
    connection.dispose();
    connection.contentReady(7);
    ports[0]!.onMessage.emit({ type: 'state', state: readyState });
    connection.send({ action: 'run' });
    expect(connection.activeTabId).toBeUndefined();
    expect(opened).toHaveLength(1);
    expect(states).toEqual([null]);
    expect(ports[0]!.sent).toEqual([]);
  });
});
