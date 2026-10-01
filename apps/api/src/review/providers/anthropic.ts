import { createAnthropicChat } from '@tanstack/ai-anthropic';

import { INVALID_TOOL_INPUT } from '../errors';
export { INVALID_TOOL_INPUT } from '../errors';

/** 固定した TanStack adapter 版で失われる pause_turn の継続を補う。 */
export function anthropicAdapter(
  model: string,
  apiKey: string,
  config: NonNullable<Parameters<typeof createAnthropicChat>[2]>,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  let paused = false;
  let content: Record<string, unknown>[] = [];
  const continuations: { role: 'assistant'; content: Record<string, unknown>[] }[] = [];
  const adapter = createAnthropicChat(model as Parameters<typeof createAnthropicChat>[0], apiKey, {
    ...config,
    fetch: async (input, init) => {
      const body = JSON.parse(init?.body as string);
      const response = await fetcher(input, { ...init, body: JSON.stringify({ ...body, messages: [...body.messages, ...continuations] }) });
      if (!response.ok || !response.body) return response;
      const decoder = new TextDecoder();
      const inputs = new Map<number, string>();
      let pending = '';
      const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          pending += decoder.decode(chunk, { stream: true });
          const lines = pending.split('\n');
          pending = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            let event;
            try { event = JSON.parse(line.slice(5).trimStart()); } catch { continue; }
            if (event.type === 'message_delta' && event.delta?.stop_reason === 'pause_turn') paused = true;
            if (event.type === 'content_block_start') content[event.index] = { ...event.content_block };
            const block = content[event.index];
            if (!block) continue;
            if (event.type === 'content_block_delta') {
              const delta = event.delta;
              if (delta.type === 'input_json_delta') inputs.set(event.index, (inputs.get(event.index) ?? '') + delta.partial_json);
              if (delta.type === 'text_delta') block.text = String(block.text ?? '') + delta.text;
              if (delta.type === 'thinking_delta') block.thinking = String(block.thinking ?? '') + delta.thinking;
              if (delta.type === 'signature_delta') block.signature = String(block.signature ?? '') + delta.signature;
            }
            if (event.type === 'content_block_stop' && inputs.has(event.index)) {
              try { block.input = JSON.parse(inputs.get(event.index)!); }
              catch { throw new Error(INVALID_TOOL_INPUT); }
            }
          }
          controller.enqueue(chunk);
        },
      }));
      return new Response(stream, { status: response.status, headers: response.headers });
    },
  });
  const original = adapter.chatStream.bind(adapter);
  adapter.chatStream = async function* (options) {
    continuations.length = 0;
    for (let turn = 0; turn < 5; turn++) {
      paused = false;
      content = [];
      for await (const event of original(options)) {
        if (event.type === 'RUN_FINISHED' && paused) continue;
        yield event;
      }
      if (!paused) return;
      continuations.push({ role: 'assistant', content });
    }
    throw new Error('検索継続回数の上限に達しました');
  };
  return adapter;
}
