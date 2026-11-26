import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const devUrl = process.argv.find(arg => arg.startsWith('--url='))?.slice(6);
const root = resolve('dist');
const prefix = '/nagi/';
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.wav': 'audio/wav'
};
const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const file = resolve(root, pathname.slice(prefix.length) || 'index.html');
  if (!pathname.startsWith(prefix) || !file.startsWith(root + sep)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    res.end(content);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error(error);
    res.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
  }
});
if (!devUrl) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    Math.random = () => 0.25;
    const schedule = AudioParam.prototype.setTargetAtTime;
    window.strokeGainTargets = [];
    AudioParam.prototype.setTargetAtTime = function(target, time, decay) {
      window.strokeGainTargets.push(target);
      return schedule.call(this, target, time, decay);
    };
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (!response.ok() && response.status() !== 304) errors.push(response.url()); });
  await page.goto(devUrl ?? `http://127.0.0.1:${server.address().port}${prefix}`);
  await page.locator('#lighting:enabled').waitFor();
  const hashes = {};
  const capture = () => page.evaluate(() => {
      const canvas = document.querySelector('#water');
      const gl = canvas.getContext('webgl2');
      const program = gl.getParameter(gl.CURRENT_PROGRAM);
      gl.uniform1f(gl.getUniformLocation(program, 'uTime'), 4);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const { width, height } = canvas;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError()) throw Error('WebGL readback failed');
      const copy = document.createElement('canvas');
      copy.width = width;
      copy.height = height;
      const ctx = copy.getContext('2d');
      const image = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        image.data.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4);
      }
      ctx.putImageData(image, 0, 0);
      return copy.toDataURL().split(',')[1];
    });
  const hashFrame = async () => createHash('sha256').update(Buffer.from(await capture(), 'base64')).digest('hex');
  for (const phase of ['day', 'sunset', 'night']) {
    assert.equal(await page.locator('#lighting').getAttribute('data-phase'), phase);
    hashes[phase] = await hashFrame();
    await page.locator('#lighting').click();
  }
  const tuning = page.locator('#water-tuning');
  if (devUrl) {
    await tuning.locator('summary').click();
    for (const [name, value] of [
      ['horizon', '35'], ['skyBlue', '1.3'], ['distantTransition', '1.4'], ['reflection', '0.75']
    ]) {
      await page.locator(`#water-tune-${name}`).fill(value);
      assert.notEqual(await hashFrame(), hashes.day, `${name} changes the frame without restarting animation`);
      await tuning.getByRole('button', { name: '恢复默认' }).click();
      assert.equal(await hashFrame(), hashes.day, `${name} reset returns to the original frame`);
    }
    await tuning.locator('summary').click();
  } else {
    assert.equal(await tuning.count(), 0, 'tuning UI is absent in production');
  }
  await page.setViewportSize({ width: 700, height: 420 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#water');
    const gl = canvas.getContext('webgl2');
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    const resolution = gl.getUniform(program, gl.getUniformLocation(program, 'uResolution'));
    return resolution[0] === 700 && resolution[1] === 420;
  });
  await page.evaluate(() => {
    const gl = document.querySelector('#water').getContext('webgl2');
    const extension = gl.getExtension('WEBGL_lose_context');
    extension.loseContext();
    document.querySelector('#water').addEventListener('webglcontextlost',
      () => setTimeout(() => extension.restoreContext(), 100), { once: true });
  });
  await page.locator('#lighting:disabled').waitFor();
  await page.locator('#lighting:enabled').waitFor();
  assert.equal(await page.evaluate(() => {
    const gl = document.querySelector('#water').getContext('webgl2');
    return !gl.isContextLost() && Boolean(gl.getParameter(gl.CURRENT_PROGRAM));
  }), true, 'WebGL renderer recreates its program after context restore');
  await page.setViewportSize({ width: 640, height: 400 });
  await page.locator('#sound').click();
  await page.locator('#sound[aria-pressed=true]:enabled').waitFor();
  assert.equal(await page.locator('#sound-error').isHidden(), true);
  const sendPointer = (kind, x, y) => page.locator('#water').dispatchEvent(`pointer${kind}`, {
    pointerType: 'mouse', clientX: x, clientY: y
  });
  await page.locator('#water').evaluate(canvas => {
    const send = (kind, clientX) => canvas.dispatchEvent(new PointerEvent(`pointer${kind}`, {
      pointerType: 'mouse', clientX, clientY: 270
    }));
    window.strokeGainTargets.length = 0;
    send('enter', 200);
    send('move', 210);
  });
  assert.deepEqual(await page.evaluate(() => window.strokeGainTargets), [], 'entry grace period suppresses audio');
  await page.waitForTimeout(190);
  await sendPointer('move', 212, 270);
  assert.deepEqual(await page.evaluate(() => window.strokeGainTargets), [], '2px is too short to start audio');
  await sendPointer('move', 215, 270);
  await page.waitForFunction(() => window.strokeGainTargets.length >= 2);
  assert.deepEqual(await page.evaluate(() => window.strokeGainTargets), [0.65, 0], 'short motion fades in and idle fades out');
  await sendPointer('move', 220, 270);
  await sendPointer('move', 225, 35);
  assert.deepEqual(await page.evaluate(() => window.strokeGainTargets.slice(-2)), [0.65, 0], 'sky stops audio');
  await page.locator('#sound').click();
  await page.locator('#sound[aria-pressed=false]:enabled').waitFor();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.mouse.move(200, 35);
  await page.mouse.move(315, 35);
  await page.waitForTimeout(280);
  const counts = () => page.evaluate(() => {
    const gl = document.querySelector('#water').getContext('webgl2');
    const p = gl.getParameter(gl.CURRENT_PROGRAM);
    return ['uDropCount', 'uRippleCount'].map(n => gl.getUniform(p, gl.getUniformLocation(p, n)));
  });
  assert.deepEqual(await counts(), [0, 0], 'sky does not create ripples');
  await page.mouse.move(300, 270);
  await page.mouse.move(305, 270);
  await page.waitForTimeout(300);
  assert.deepEqual(await counts(), [1, 0], 'short stroke creates one drop');
  await page.mouse.move(460, 275, { steps: 8 });
  await page.waitForFunction(() => {
    const gl = document.querySelector('#water').getContext('webgl2');
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    return gl.getUniform(program, gl.getUniformLocation(program, 'uRippleCount')) > 0;
  });
  if (devUrl) {
    const result = await page.evaluate(async () => {
      const { createFishSchool } = await import('/src/scene/fish.ts');
      const calm = createFishSchool();
      const startled = createFishSchool();
      // Startle at a deep fish near the back of the school, with others outside the radius.
      const initial = calm.update(0);
      const hit = { x: initial[0] * 0.96, z: initial[1] * 0.96 };
      startled.update(0);
      startled.startle(hit, hit, 0.6, 0);
      const displacements = t => {
        const a = calm.update(t);
        const b = startled.update(t);
        return Array.from({ length: 6 }, (_, i) => Math.hypot(a[4 * i] - b[4 * i], a[4 * i + 1] - b[4 * i + 1]));
      };
      return [displacements(0.3), displacements(8)];
    });
    assert.ok(result[0][0] > 0.05, 'nearby fish reacts immediately');
    assert.equal(result[0][5], 0, 'far fish is unaffected');
    assert.ok(result[1][0] > result[0][0], 'affected fish does not return to its old path');
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(hashes, JSON.parse(await readFile('tests/baseline/sha256.json', 'utf8')), 'same-browser reference frames');
  console.log('Three reference frames matched; resize, WebGL restore, sky, short/long strokes and audio passed.');
} finally {
  await browser?.close();
  server.close();
}
