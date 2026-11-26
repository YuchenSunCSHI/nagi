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
  await page.addInitScript(() => { Math.random = () => 0.25; });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (!response.ok() && response.status() !== 304) errors.push(response.url()); });
  await page.goto(devUrl ?? `http://127.0.0.1:${server.address().port}${prefix}`);
  await page.locator('#lighting:enabled').waitFor();
  const hashes = {};
  for (const phase of ['day', 'sunset', 'night']) {
    assert.equal(await page.locator('#lighting').getAttribute('data-phase'), phase);
    const frame = await page.evaluate(() => {
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
    const png = Buffer.from(frame, 'base64');
    hashes[phase] = createHash('sha256').update(png).digest('hex');
    await page.locator('#lighting').click();
  }
  await page.locator('#sound').click();
  await page.locator('#sound[aria-pressed=true]:enabled').waitFor();
  assert.equal(await page.locator('#sound-error').isHidden(), true);
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
  assert.ok((await counts())[1] > 0, 'long stroke creates a wake');
  assert.deepEqual(errors, []);
  assert.deepEqual(hashes, JSON.parse(await readFile('tests/baseline/sha256.json', 'utf8')), 'same-browser reference frames');
  console.log('Three reference frames matched; sky, short/long strokes and audio passed.');
} finally {
  await browser?.close();
  server.close();
}
