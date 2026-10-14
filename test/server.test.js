import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startServer, resolvePath } from '../scripts/serve.mjs';

function get(port, path) {
  return new Promise((ok, fail) => {
    const r = request({ host: '127.0.0.1', port, path, method: 'GET' }, res => { let b = ''; res.on('data', d => (b += d)); res.on('end', () => ok({ status: res.statusCode, body: b })); });
    r.on('error', fail); r.end();
  });
}

test('server survives malformed, traversal and hidden paths', async () => {
  const server = await startServer(0);
  const port = server.address().port;
  try {
    const cases = [['/%E0%A4%A', 400], ['/%', 400], ['/%zz', 400], ['/%00', 400], ['/../../../etc/passwd', 404], ['/..%2f..%2fetc%2fpasswd', 404],
      ['/%2e%2e/%2e%2e/etc/passwd', 404], ['/.git/config', 404], ['/test/logic.test.js', 404], ['/evidence/x', 404], ['/nope.js', 404], ['/src', 404]];
    for (const [path, want] of cases) assert.equal((await get(port, path)).status, want, path);
    const ok = await get(port, '/');
    assert.equal(ok.status, 200); assert.match(ok.body, /<title>DemoBudget<\/title>/);
    assert.equal((await get(port, '/src/logic.js')).status, 200, 'still serving after adverse requests');
  } finally { server.close(); }
});

test('resolvePath unit cases', () => {
  assert.equal(resolvePath('/%E0%A4%A').status, 400);
  assert.equal(resolvePath('/index.html').status, 200);
  assert.equal(resolvePath('/').status, 200);
});

test('server works from a real directory whose path contains spaces', async () => {
  const { mkdtemp, cp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawn } = await import('node:child_process');
  const base = await mkdtemp(join(tmpdir(), 'demo budget '));
  const dir = join(base, 'my app %20 dir');
  const src = new URL('..', import.meta.url);
  for (const f of ['index.html', 'src', 'scripts']) await cp(new URL(f, src), join(dir, f), { recursive: true });
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [join(dir, 'scripts', 'serve.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((ok, fail) => { child.stdout.once('data', ok); child.once('exit', c => fail(new Error('server exited ' + c))); });
    const page = await get(port, '/');
    assert.equal(page.status, 200); assert.match(page.body, /<title>DemoBudget<\/title>/);
    assert.equal((await get(port, '/src/logic.js')).status, 200);
    assert.equal((await get(port, '/%E0%A4%A')).status, 400);
  } finally { child.kill(); await rm(base, { recursive: true, force: true }); }
});
