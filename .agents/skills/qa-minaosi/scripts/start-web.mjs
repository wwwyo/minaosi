#!/usr/bin/env node
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(resolve(process.argv[2], 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('wxt')).href);

// Disable the automatic runner so a global browser preference cannot open a personal profile.
await (await createServer({
  root: process.argv[2],
  webExt: { disabled: true },
  dev: { server: { host: '127.0.0.1', port: Number(process.argv[3]) } },
})).start();
