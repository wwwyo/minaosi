const MESSAGE_TYPE = 'minaosi-turnstile';
const ACQUIRE_TIMEOUT_MS = 90_000;
const LOAD_TIMEOUT_MS = 15_000;

/**
 * 校閲サーバーが配る /turnstile の widget ページを iframe で開き、確認トークンを受け取る。
 * side panel（拡張の document）内で使う前提。content script 側へ埋める構成は
 * ページの CSP frame-src に依存するため採らない（docs/review-gateway.md 参照）。
 */
export class TurnstileGate {
  private frame: HTMLIFrameElement | null = null;
  private ready: Promise<HTMLIFrameElement> | null = null;
  private pending: { resolve(token: string): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | null = null;

  private constructor(
    private readonly pageUrl: string,
    private readonly origin: string,
  ) {}

  /** 校閲サーバーの /review URL から widget ページのURLを組み立てる。未設定・不正なURLは null。 */
  static fromReviewEndpoint(endpoint: string): TurnstileGate | null {
    if (!endpoint) return null;
    try {
      const page = new URL('/turnstile', endpoint);
      return new TurnstileGate(page.href, page.origin);
    } catch {
      return null;
    }
  }

  /** 新しいトークンを1件取得する。同時実行は認めない（トークンは使い切り）。 */
  async acquire(): Promise<string> {
    if (this.pending) throw new Error('人間性の確認を実行中です');
    const frame = await this.mount();
    return new Promise<string>((resolve, reject) => {
      this.pending = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.settle(null, new Error('人間性の確認がタイムアウトしました。もう一度お試しください'));
        }, ACQUIRE_TIMEOUT_MS),
      };
      frame.contentWindow?.postMessage({ type: MESSAGE_TYPE, event: 'execute' }, this.origin);
    });
  }

  dispose() {
    window.removeEventListener('message', this.onMessage);
    this.settle(null, new Error('人間性の確認を中断しました'));
    this.frame?.remove();
    this.frame = null;
    this.ready = null;
  }

  private mount(): Promise<HTMLIFrameElement> {
    if (this.ready) return this.ready;
    const frame = document.createElement('iframe');
    frame.src = this.pageUrl;
    frame.title = '人間性の確認';
    frame.tabIndex = -1;
    this.show(frame, false);
    this.ready = new Promise<HTMLIFrameElement>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('確認ページを読み込めませんでした')), LOAD_TIMEOUT_MS);
      frame.addEventListener('load', () => {
        clearTimeout(timer);
        resolve(frame);
      });
    });
    this.ready.catch(() => {
      // 読み込みに失敗した枠は破棄し、次回の acquire で作り直す
      if (this.frame === frame) {
        this.frame = null;
        this.ready = null;
        window.removeEventListener('message', this.onMessage);
        frame.remove();
      }
    });
    window.addEventListener('message', this.onMessage);
    this.frame = frame;
    document.body.append(frame);
    return this.ready;
  }

  private onMessage = (e: MessageEvent) => {
    if (e.origin !== this.origin || e.source !== this.frame?.contentWindow) return;
    const data = e.data as { type?: string; event?: string; token?: unknown; interactive?: unknown } | undefined;
    if (data?.type !== MESSAGE_TYPE) return;
    switch (data.event) {
      case 'token':
        if (typeof data.token === 'string') this.settle(data.token, null);
        return;
      case 'interactive':
        if (this.frame) this.show(this.frame, data.interactive === true);
        return;
      case 'expired':
        this.settle(null, new Error('確認の有効期限が切れました。もう一度お試しください'));
        return;
      case 'timeout':
        this.settle(null, new Error('確認がタイムアウトしました。もう一度お試しください'));
        return;
      case 'unsupported':
        this.settle(null, new Error('このブラウザでは人間性の確認を実行できません'));
        return;
      case 'error':
        this.settle(null, new Error('人間性の確認に失敗しました。もう一度お試しください'));
        return;
    }
  };

  private settle(token: string | null, error: Error | null) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    if (this.frame) this.show(this.frame, false);
    if (token !== null) pending.resolve(token);
    else pending.reject(error ?? new Error('人間性の確認に失敗しました'));
  }

  /** 対話が必要なときだけ widget を表示し、通常は画面外に置く。 */
  private show(frame: HTMLIFrameElement, visible: boolean) {
    frame.style.cssText = visible
      ? 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);width:310px;height:190px;border:0;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.35);background:#fff;z-index:2147483647;'
      : 'position:fixed;left:-10000px;top:0;width:300px;height:65px;border:0;';
    frame.setAttribute('aria-hidden', String(!visible));
  }
}
