import { DurableObject } from 'cloudflare:workers';
import type { Env } from './worker';

/** 標準サービスの実行枠を、利用者やモデルによらず共有する。 */
export class ReviewConcurrency extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');
  }

  acquire(): string | null {
    const policy = this.env.REVIEW_POLICY;
    if (!policy || !Number.isSafeInteger(policy.concurrencyLimit) || policy.concurrencyLimit < 1 ||
        !Number.isSafeInteger(policy.leaseTtlMs) || policy.leaseTtlMs < 240_000) throw new Error('実行枠の設定が不正です');
    return this.ctx.storage.transactionSync(() => {
      const now = Date.now();
      // Workerが終了してfinallyに到達しなくても、失われた枠を永久に占有しない。
      this.ctx.storage.sql.exec('DELETE FROM leases WHERE expires_at <= ?', now);
      const { count } = this.ctx.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM leases').one();
      if (count >= policy.concurrencyLimit) return null;
      const id = crypto.randomUUID();
      this.ctx.storage.sql.exec('INSERT INTO leases (id, expires_at) VALUES (?, ?)', id, now + policy.leaseTtlMs);
      return id;
    });
  }

  release(id: string): void {
    this.ctx.storage.sql.exec('DELETE FROM leases WHERE id = ?', id);
  }
}
