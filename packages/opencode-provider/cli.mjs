#!/usr/bin/env node
// CLI for the opencode provider daemon (T08, issue #18).
// Zero-dependency ESM: `node cli.mjs [--port 0] [--host 127.0.0.1]
// [--model gdevelop-local] [--verbose]`.

import { startServer, OPENAI_MODEL_ID } from './server.mjs';

const usage = `opencode-provider: local OpenAI-compatible bridge for GDevelop

Usage: opencode-provider [options]

  --port <n>     TCP port to listen on (0 = ephemeral, default 0)
  --host <addr>  bind address (default 127.0.0.1; keep loopback for zero egress)
  --model <id>   model id advertised on /v1/models (default ${OPENAI_MODEL_ID})
  --verbose      log each request line
  --help         this message
`;

const args = process.argv.slice(2);
const options = { port: 0, host: '127.0.0.1', model: OPENAI_MODEL_ID, verbose: false };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    console.log(usage);
    process.exit(0);
  } else if (arg === '--verbose' || arg === '-v') {
    options.verbose = true;
  } else if (arg === '--port' && i + 1 < args.length) {
    options.port = Number(args[++i]);
  } else if (arg.startsWith('--port=')) {
    options.port = Number(arg.split('=')[1]);
  } else if (arg === '--host' && i + 1 < args.length) {
    options.host = args[++i];
  } else if (arg.startsWith('--host=')) {
    options.host = arg.split('=')[1];
  } else if (arg === '--model' && i + 1 < args.length) {
    options.model = args[++i];
  } else if (arg.startsWith('--model=')) {
    options.model = arg.split('=')[1];
  } else {
    console.error(`opencode-provider: unknown argument "${arg}"\n\n${usage}`);
    process.exit(2);
  }
}

if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
  console.error(`opencode-provider: invalid --port (${String(options.port)})`);
  process.exit(2);
}

const handle = await startServer({
  host: options.host,
  port: options.port,
  model: options.model,
});
const actual = handle.address();
console.log(
  `opencode-provider listening on http://${actual.address}:${actual.port} (model ${options.model})`
);

const shutdown = () => {
  handle.close().then(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
