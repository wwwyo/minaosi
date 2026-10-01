import { hc } from 'hono/client';
import type { AppType } from '@minaosi/api/rpc';

/** API側のルート変更で、リクエストとレスポンスの型が失われないことを検証する。 */
async function contract(client: ReturnType<typeof hc<AppType>>) {
  // @ts-expect-error blocks is required by the API validator
  await client.review.$post({ json: { mode: 'default' } });
  // @ts-expect-error unrecognized review modes must not compile
  await client.review.$post({ json: { mode: 'other', blocks: [] } });
  // @ts-expect-error endpoints are inferred from the Hono routes
  await client.missing.$post({ json: {} });
  const response = await client.review.$post({ json: { mode: 'default', blocks: [{ index: 0, text: '原稿' }] } });
  if (response.status === 200) {
    const data = await response.json();
    const title: string | undefined = data.findings[0]?.title;
    // @ts-expect-error response fields retain their actual type
    const invalidTitle: number = data.findings[0]?.title;
    void [title, invalidTitle];
  }
}

void contract;
