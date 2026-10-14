import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';

// Symlink regressions for D5 (moved here from server.test.js so that file stays identical to freeze-r6).
function get(port, path) {
  return new Promise((ok, fail) => {
    const r = request({ host: '127.0.0.1', port, path, method: 'GET' }, res => { let b = ''; res.on('data', d => (b += d)); res.on('end', () => ok({ status: res.statusCode, body: b })); });
    r.on('error', fail); r.end();
  });
}

test('CLI starts when invoked through a symlinked path', async () => {
  const { mkdtemp, cp, rm, symlink } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawn } = await import('node:child_process');
  const base = await mkdtemp(join(tmpdir(), 'demobudget-link-'));
  const real = join(base, 'real');
  const src = new URL('..', import.meta.url);
  for (const f of ['index.html', 'src', 'scripts']) await cp(new URL(f, src), join(real, f), { recursive: true });
  await symlink(real, join(base, 'linked'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [join(base, 'linked', 'scripts', 'serve.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((ok, fail) => {
      child.stdout.once('data', ok);
      child.once('exit', c => fail(new Error('server exited before listening, code ' + c)));
    });
    const page = await get(port, '/');
    assert.equal(page.status, 200); assert.match(page.body, /<title>DemoBudget<\/title>/);
  } finally { child.kill(); await rm(base, { recursive: true, force: true }); }
});

test('isMainModule compares canonical paths', async () => {
  const { isMainModule } = await import('../scripts/serve.mjs');
  const { fileURLToPath } = await import('node:url');
  const self = new URL('../scripts/serve.mjs', import.meta.url);
  assert.equal(isMainModule(fileURLToPath(self), self.href), true);
  assert.equal(isMainModule(undefined, self.href), false);
  assert.equal(isMainModule('/nonexistent/other.mjs', self.href), false);
});

test('CLI starts when invoked through a symlinked file', async () => {
  const { mkdtemp, cp, rm, symlink } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawn } = await import('node:child_process');
  const base = await mkdtemp(join(tmpdir(), 'demobudget-filelink-'));
  const real = join(base, 'real');
  const src = new URL('..', import.meta.url);
  for (const f of ['index.html', 'src', 'scripts']) await cp(new URL(f, src), join(real, f), { recursive: true });
  await symlink(join(real, 'scripts', 'serve.mjs'), join(base, 'serve-link.mjs'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [join(base, 'serve-link.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((ok, fail) => {
      child.stdout.once('data', ok);
      child.once('exit', c => fail(new Error('server exited before listening, code ' + c)));
    });
    const page = await get(port, '/');
    assert.equal(page.status, 200); assert.match(page.body, /<title>DemoBudget<\/title>/);
  } finally { child.kill(); await rm(base, { recursive: true, force: true }); }
});
