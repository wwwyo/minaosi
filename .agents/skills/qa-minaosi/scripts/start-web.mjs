#!/usr/bin/env node
import { createServer } from 'wxt';

// Disable the automatic runner so a global browser preference cannot open a personal profile.
await (await createServer({
  root: process.argv[2],
  webExt: { disabled: true },
  dev: { server: { host: '127.0.0.1', port: Number(process.argv[3]) } },
})).start();
