export class PanelToggle {
  private open: boolean | null = null;
  private revision = 0;
  private busy = false;

  constructor(private changed: (open: boolean | null, busy: boolean) => void) {}

  receive(open: boolean) {
    this.revision++;
    this.open = open;
    this.changed(this.open, this.busy);
  }

  async initialize(load: () => Promise<boolean>) {
    const revision = this.revision;
    const open = await load();
    // 読込中に閉じるボタンやtoolbarから操作された場合は、後発の通知を優先する。
    if (revision === this.revision) this.receive(open);
  }

  async toggle(setOpen: (open: boolean) => Promise<void>) {
    if (this.open === null || this.busy) return;
    const previous = this.open;
    this.busy = true;
    this.receive(!previous);
    const revision = this.revision;
    try {
      // 開くAPIはuser gestureが必要なため、ここまでawaitを挟まない。
      await setOpen(!previous);
    } catch (error) {
      if (revision === this.revision) this.receive(previous);
      throw error;
    } finally {
      this.busy = false;
      this.changed(this.open, this.busy);
    }
  }
}
