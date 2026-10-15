import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.local/sdk-release');
mkdirSync(output, { recursive: true });
const packages = ['protocol', 'types', 'core', 'browser'];
const archives = [];
let version;
for (const name of packages) {
  const directory = join(root, 'packages', name);
  const source = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  version ??= source.version;
  assert.equal(source.version, version);
  assert.match(version, /^\d+\.\d+\.\d+-alpha\.\d+$/);
  assert.equal(source.license, 'MIT');
  execFileSync('pnpm', ['--dir', directory, 'pack', '--pack-destination', output], {
    cwd: root,
    stdio: 'pipe',
  });
  const archive = join(output, `spectro-${name}-${version}.tgz`);
  const files = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(files.includes('package/LICENSE'));
  assert.ok(files.includes('package/README.md'));
  assert.ok(files.every((file) => !/\.test\.|\.tsbuildinfo|(^|\/)\._|(^|\/)\.env/.test(file)));
  assert.ok(
    files.every((file) => /^package\/(dist\/|package.json$|LICENSE$|README.md$)/.test(file)),
  );
  const manifest = JSON.parse(
    execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }),
  );
  assert.doesNotMatch(JSON.stringify(manifest), /(?:workspace|catalog):/);
  for (const [dependency, target] of Object.entries(manifest.dependencies ?? {})) {
    if (dependency.startsWith('@spectro/')) assert.equal(target, version);
  }
  for (const entry of Object.values(manifest.exports)) {
    for (const target of typeof entry === 'string' ? [entry] : Object.values(entry)) {
      if (!target.includes('*'))
        assert.ok(files.includes(`package/${target.replace(/^\.\//, '')}`));
    }
  }
  archives.push(archive);
  console.log(`Verified contents: @spectro/${name}@${version}`);
}

// Outside the monorepo: no workspace links or root dependency fallbacks.
const consumer = mkdtempSync(join(tmpdir(), 'spectro-sdk-consumer-'));
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
execFileSync(
  'npm',
  [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--registry=https://registry.npmjs.org',
    ...archives,
  ],
  {
    cwd: consumer,
    stdio: 'pipe',
    timeout: 120_000,
  },
);
writeFileSync(
  join(consumer, 'smoke.mjs'),
  `
import assert from 'node:assert/strict';
import { init } from '@spectro/browser';
import { createEventContext } from '@spectro/core';
import { MAX_KEEPALIVE_ENVELOPE_BYTES } from '@spectro/types';
import { validateEnvelope } from '@spectro/protocol';
const options = { projectId: 'prj_smoke', environment: 'test', apiKey: 'sp_release_smoke', endpoint: 'https://ingest.example.test' };
assert.equal(createEventContext(options).sdk.version, ${JSON.stringify(version)});
assert.ok(MAX_KEEPALIVE_ENVELOPE_BYTES > 0);
let submitted = false;
let rejectDelivery = false;
const client = init({ ...options, errors: false, lifecycle: false, network: false, performance: false, interactions: false, persistence: false,
  fetch: async (url, request) => {
    assert.equal(url, 'https://ingest.example.test/v1/envelope');
    assert.equal(request.headers['x-spectro-key'], options.apiKey);
    const envelope = JSON.parse(request.body);
    assert.ok(validateEnvelope(envelope).success);
    assert.equal(envelope.items[0].payload.payload.properties.safe, true);
    assert.ok(!request.body.includes('must_not_ship'));
    assert.ok(!request.body.includes(options.apiKey));
    if (rejectDelivery) return new Response('', { status: 503 });
    submitted = true;
    return new Response(JSON.stringify({ accepted: envelope.items.length }), { status: 202 });
  }
});
assert.ok(client);
assert.ok(client.track('sdk_release_smoke', { safe: true, password: 'must_not_ship' }));
const result = await client.flush();
assert.equal(result.sent, 1);
assert.ok(submitted);
rejectDelivery = true;
assert.ok(client.track('sdk_retry_smoke', { safe: true }));
const failed = await client.flush();
assert.equal(failed.sent, 0);
assert.equal(failed.remaining, 1);
rejectDelivery = false;
assert.equal((await client.flush()).sent, 1);
client.destroy();
console.log('Independent runtime and privacy smoke passed');
`,
);
execFileSync(process.execPath, [join(consumer, 'smoke.mjs')], { cwd: consumer, stdio: 'inherit' });
writeFileSync(
  join(consumer, 'main.ts'),
  `import { init, track, type BrowserClientOptions } from '@spectro/browser';
const options: BrowserClientOptions = { projectId: 'prj_smoke', environment: 'test', apiKey: 'sp_smoke', endpoint: 'https://ingest.example.test' };
init(options); track('sdk_release_smoke', { safe: true });
`,
);
writeFileSync(
  join(consumer, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      target: 'ES2022',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      types: [],
    },
    include: ['main.ts'],
  }),
);
execFileSync('pnpm', ['exec', 'tsc', '-p', join(consumer, 'tsconfig.json')], {
  cwd: root,
  stdio: 'inherit',
});
writeFileSync(
  join(consumer, 'index.html'),
  '<div id="app"></div><script type="module" src="/main.ts"></script>',
);
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { build } = await import(pathToFileURL(webRequire.resolve('vite')).href);
await build({ root: consumer, configFile: false, logLevel: 'warn', build: { write: false } });
console.log(`SDK tarballs passed runtime, type and browser build acceptance: ${output}`);
