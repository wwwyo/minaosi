import { generateText, Output, jsonSchema, tool } from 'ai';
import { chromium } from 'playwright';
import { accessModel, ACCESS_MODEL, AccessError } from '../tests/support/access-model';

// Preflight uses synthetic pixels only; the E2E runner still validates its own response grammars.
try {
  const model = accessModel();
  const browser = await chromium.launch({ env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' } });
  try {
    const page = await browser.newPage({ viewport: { width: 200, height: 100 } });
    const schema = jsonSchema<{ color: string }>({ type: 'object', properties: { color: { type: 'string', enum: ['red', 'blue', 'green'] } }, required: ['color'], additionalProperties: false });
    let image: Buffer;
    for (const color of ['red', 'blue']) {
      await page.setContent(`<body style="margin:0;background:${color}"></body>`);
      image = await page.screenshot();
      const result = await generateText({
        model, maxRetries: 0, maxOutputTokens: 128, abortSignal: AbortSignal.timeout(60_000),
        messages: [{ role: 'user', content: [{ type: 'text', text: 'What color fills this image? Return the color in JSON.' }, { type: 'file', data: image, mediaType: 'image/png' }] }],
        output: Output.object({ schema }),
      });
      if (result.output?.color !== color) throw new AccessError('MODEL_VISION_INVALID', 'Model failed the synthetic color judgment.');
    }
    const result = await generateText({
      model, maxRetries: 0, maxOutputTokens: 128, abortSignal: AbortSignal.timeout(60_000),
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Call record_color with the color filling this image.' }, { type: 'file', data: image!, mediaType: 'image/png' }] }],
      tools: { record_color: tool({ description: 'Record the image color', inputSchema: schema }) },
      toolChoice: { type: 'tool', toolName: 'record_color' },
    });
    if (result.toolCalls.length !== 1 || result.toolCalls[0]?.toolName !== 'record_color' || (result.toolCalls[0].input as { color?: string }).color !== 'blue') {
      throw new AccessError('MODEL_TOOLS_INVALID', 'Model failed the synthetic tool call.');
    }
    console.log(JSON.stringify({ status: 'passed', model: ACCESS_MODEL, checks: ['vision-red', 'vision-blue', 'json-schema', 'tool-call'], requests: 3 }));
  } finally { await browser.close(); }
} catch (error) {
  // SDK errors can contain response/request data; this CLI exposes only the safe transport error.
  let cause: unknown = error;
  for (let depth = 0; depth < 8 && cause instanceof Error; depth++) {
    if (cause instanceof AccessError) { console.error(JSON.stringify({ status: 'failed', code: cause.code, message: cause.message })); process.exit(1); }
    cause = (cause as Error & { cause?: unknown }).cause;
  }
  console.error(JSON.stringify({ status: 'failed', code: 'MODEL_CAPABILITY_FAILED', message: 'Vision, schema or tool calling preflight failed; no SDK payload is logged.' }));
  process.exitCode = 1;
}
