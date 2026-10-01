import { describe, expect, test } from 'bun:test';
import { PanelToggle } from './panel-toggle';

describe('paneの開閉', () => {
  test('初期状態の確認前は操作しない', async () => {
    const calls: boolean[] = [];
    const toggle = new PanelToggle(() => {});
    await toggle.toggle(async (open) => { calls.push(open); });
    expect(calls).toEqual([]);
  });

  test('クリックと同じ同期処理内で開き、次のクリックで閉じる', async () => {
    const calls: boolean[] = [];
    const toggle = new PanelToggle(() => {});
    await toggle.initialize(async () => false);
    const opening = toggle.toggle(async (open) => { calls.push(open); });
    expect(calls).toEqual([true]);
    await opening;
    await toggle.toggle(async (open) => { calls.push(open); });
    expect(calls).toEqual([true, false]);
  });

  test('Chromeの閉じるボタンからの通知後は、次のクリックで開く', async () => {
    const calls: boolean[] = [];
    const toggle = new PanelToggle(() => {});
    await toggle.initialize(async () => true);
    toggle.receive(false);
    await toggle.toggle(async (open) => { calls.push(open); });
    expect(calls).toEqual([true]);
  });

  test('初期読込より新しい開閉通知を優先する', async () => {
    const loading = Promise.withResolvers<boolean>();
    const calls: boolean[] = [];
    const toggle = new PanelToggle(() => {});
    const initialized = toggle.initialize(() => loading.promise);
    toggle.receive(true);
    loading.resolve(false);
    await initialized;
    await toggle.toggle(async (open) => { calls.push(open); });
    expect(calls).toEqual([false]);
  });

  test('APIの応答待ちに連打しても開閉を重複させない', async () => {
    const pending = Promise.withResolvers<void>();
    const calls: boolean[] = [];
    const toggle = new PanelToggle(() => {});
    toggle.receive(false);
    const opening = toggle.toggle((open) => { calls.push(open); return pending.promise; });
    await toggle.toggle(async (open) => { calls.push(open); });
    expect(calls).toEqual([true]);
    pending.resolve();
    await opening;
  });

  test('操作失敗後は元の状態に戻し、再度開ける', async () => {
    const calls: boolean[] = [];
    const toggle = new PanelToggle(() => {});
    toggle.receive(false);
    await expect(toggle.toggle(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await toggle.toggle(async (open) => { calls.push(open); });
    expect(calls).toEqual([true]);
  });

  test('失敗応答より新しいChromeの状態通知を維持する', async () => {
    const pending = Promise.withResolvers<void>();
    const calls: boolean[] = [];
    const toggle = new PanelToggle(() => {});
    toggle.receive(false);
    const opening = toggle.toggle(() => pending.promise);
    toggle.receive(true);
    pending.reject(new Error('failed'));
    await expect(opening).rejects.toThrow('failed');
    await toggle.toggle(async (open) => { calls.push(open); });
    expect(calls).toEqual([false]);
  });
});
