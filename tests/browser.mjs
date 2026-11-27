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
  const url = new URL(devUrl ?? `http://127.0.0.1:${server.address().port}${prefix}`);
  url.searchParams.delete('tuning');
  if (devUrl) {
    await page.goto(url.href, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('#water-tuning').count(), 0, 'tuning is hidden by default in development');
  }
  url.searchParams.set('tuning', '1');
  const appUrl = url.href;
  await page.goto(appUrl);
  const lighting = page.locator('#lighting');
  const option = phase => lighting.locator(`input[value="${phase}"]`);
  const choose = phase => lighting.locator(`label:has(input[value="${phase}"])`).click();
  await lighting.locator('input:enabled').first().waitFor();
  assert.equal(await option('day').isChecked(), true);
  for (const [phase, name] of [['day', '白天'], ['sunset', '傍晚'], ['night', '月光']]) {
    assert.equal(await lighting.getByRole('radio', { name, exact: true }).getAttribute('value'), phase);
    const label = lighting.locator(`label:has(input[value="${phase}"])`);
    assert.equal(await label.getAttribute('title'), name);
    assert.equal(await label.locator('svg').isVisible(), true);
  }
  const verifyLightingMotion = async () => {
    const sunsetLabel = lighting.locator('label').filter({ has: page.getByRole('radio', { name: '傍晚' }) });
    await sunsetLabel.hover();
    const hoverFill = await sunsetLabel.locator('span').evaluate(span => getComputedStyle(span).backgroundColor);
    assert.equal(hoverFill, 'rgba(0, 0, 0, 0)', 'hover does not fill an unselected segment');
    const indicator = () => lighting.evaluate(group => {
      const style = getComputedStyle(group, '::before');
      return { offset: new DOMMatrixReadOnly(style.transform).m41, duration: style.transitionDuration };
    });
    assert.deepEqual(await indicator(), { offset: 0, duration: '0s' }, 'reduced motion starts with a stationary selection');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await lighting.evaluate(async group => {
      getComputedStyle(group, '::before').transform;
      group.querySelector('input[value="night"]').click();
      getComputedStyle(group, '::before').transform;
      const slide = group.getAnimations({ subtree: true }).find(animation => animation.transitionProperty === 'transform');
      if (!slide) throw new Error('Expected the light selection to slide');
      await slide.finished;
    });
    const nightOffset = await lighting.evaluate(group =>
      group.querySelector('input[value="night"]').parentElement.offsetLeft -
      group.querySelector('input[value="day"]').parentElement.offsetLeft);
    assert.ok(Math.abs((await indicator()).offset - nightOffset) < 1, 'the selection slides to the target segment');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await choose('day');
    assert.deepEqual(await indicator(), { offset: 0, duration: '0s' }, 'reduced motion returns directly to the selected segment');
    await page.mouse.move(0, 0);
  };
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
  for (const phase of ['day', 'night', 'sunset']) {
    if (phase !== 'day') await choose(phase);
    assert.equal(await option(phase).isChecked(), true);
    hashes[phase] = await hashFrame();
  }
  await choose('day');
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
    const sparkle = page.locator('#water-tune-daySparkle');
    assert.equal(await sparkle.inputValue(), '2', 'daylight starts at 200%');
    await sparkle.fill('0');
    assert.equal(await hashFrame(), '2c4ca5fad9e57ae4e190c6f1dd7692ba8e27b5b9340a76f9a971492759873198',
      'zero sparkle boost preserves the original daylight reflection');
    await sparkle.fill('2');
    assert.equal(await hashFrame(), hashes.day, '200% matches the initial daylight');
    await sparkle.fill('0');
    for (const phase of ['sunset', 'night']) {
      await choose(phase);
      assert.equal(await hashFrame(), hashes[phase], `day sparkle does not affect ${phase}`);
    }
    await choose('day');
    await tuning.getByRole('button', { name: '恢复默认' }).click();
    assert.equal(await sparkle.inputValue(), '2', 'reset restores the 200% slider value');
    assert.equal(await hashFrame(), hashes.day, 'reset restores the approved daylight');
    await tuning.locator('summary').click();
  } else {
    assert.equal(await tuning.count(), 0, 'tuning UI is absent in production');
  }
  await verifyLightingMotion();
  const horizonVariation = await page.locator('#water').evaluate(canvas => {
    const gl = canvas.getContext('webgl2');
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    const pitch = gl.getUniform(program, gl.getUniformLocation(program, 'uCameraPitch'));
    const [, verticalScale, margin] = gl.getUniform(program, gl.getUniformLocation(program, 'uCameraShape'));
    const horizonRow = canvas.height * (1 + pitch / verticalScale) / 2;
    const bottomRow = Math.ceil(horizonRow - margin * canvas.height / (2 * verticalScale));
    const rowCount = Math.floor(horizonRow) - bottomRow;
    const lightingUniform = gl.getUniformLocation(program, 'uLighting');
    const timeUniform = gl.getUniformLocation(program, 'uTime');
    const previousLight = gl.getUniform(program, lightingUniform);
    const previousTime = gl.getUniform(program, timeUniform);
    const sample = time => {
      const pixels = new Uint8Array(canvas.width * rowCount * 4);
      gl.uniform1f(timeUniform, time);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, bottomRow, canvas.width, rowCount, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    try {
      return [[0.5, 0.5, 0], [0.5, 0, 0.5], [0, 0.5, 0.5]].map(weights => {
        gl.uniform3fv(lightingUniform, weights);
        const first = sample(4);
        let maxDelta = 0;
        for (const time of [4.15, 4.37, 4.68]) {
          const next = sample(time);
          for (let i = 0; i < first.length; i++) maxDelta = Math.max(maxDelta, Math.abs(first[i] - next[i]));
        }
        return maxDelta;
      });
    } finally {
      gl.uniform3fv(lightingUniform, previousLight);
      gl.uniform1f(timeUniform, previousTime);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  });
  assert.ok(horizonVariation.every(delta => delta <= 1),
    `unresolved waves should not flicker next to the horizon during any lighting blend: ${horizonVariation}`);
  const phone = await browser.newPage({ viewport: { width: 320, height: 568 }, hasTouch: true, reducedMotion: 'reduce' });
  try {
    await phone.goto(appUrl);
    await phone.locator('#lighting input:enabled').first().waitFor();
    const targets = await phone.locator('.scene-lighting label, #sound').evaluateAll(elements =>
      elements.map(element => {
        const { width, height, left, right, top, bottom } = element.getBoundingClientRect();
        return { width, height, left, right, top, bottom };
      }));
    assert.ok(targets.every(({ width, height, left, right, top, bottom }) =>
      width >= 44 && height >= 44 && left >= 0 && right <= 320 && top >= 0 && bottom <= 568),
    'control targets fit a 320px touch viewport and are at least 44px in each dimension');
    await phone.locator('.scene-lighting label').filter({ has: phone.getByRole('radio', { name: '月光' }) }).tap();
    await phone.locator('#lighting input[value=night]:checked').waitFor({ state: 'attached' });
    assert.equal(await phone.locator('#water').getAttribute('aria-label'), '月光下缓缓流动的河面');
    const phoneHud = await phone.locator('.scene-controls').boundingBox();
    assert.ok(phoneHud.height < 88, 'the control bar stays on one row at 320px');
    if (devUrl) {
      await phone.locator('#water-tuning summary').tap();
      const tuningBox = await phone.locator('#water-tuning').boundingBox();
      const hudBox = await phone.locator('.scene-hud').boundingBox();
      assert.ok(tuningBox.y + tuningBox.height <= hudBox.y, 'expanded tuning does not cover mobile scene controls');
    }
  } finally {
    await phone.close();
  }
  await option('day').focus();
  assert.equal(await option('day').evaluate(input => input === document.activeElement), true);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await option('night').isChecked(), true, 'arrow keys change the selected scene');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#sound').evaluate(button => button === document.activeElement), true);
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
  await lighting.locator('input:disabled').first().waitFor();
  await lighting.locator('input:enabled').first().waitFor();
  assert.equal(await page.evaluate(() => {
    const gl = document.querySelector('#water').getContext('webgl2');
    return !gl.isContextLost() && Boolean(gl.getParameter(gl.CURRENT_PROGRAM));
  }), true, 'WebGL renderer recreates its program after context restore');
  await page.setViewportSize({ width: 640, height: 400 });
  const hud = page.locator('.scene-controls');
  const initialHud = await hud.boundingBox();
  let releaseAudio;
  const audioGate = new Promise(resolve => { releaseAudio = resolve; });
  const soundOpacity = selector => page.locator(`#sound ${selector}`).evaluate(icon => getComputedStyle(icon).opacity);
  await page.route(/water-lake-b-even[^/]*\.wav$/, async route => {
    await audioGate;
    await route.continue();
  }, { times: 1 });
  try {
    await page.locator('#sound').click();
    await page.locator('#sound:disabled').waitFor();
    assert.equal(await page.locator('#sound').getAttribute('aria-busy'), 'true');
    assert.equal(await soundOpacity('.sound-wait'), '1', 'slow audio shows the wait icon even with reduced motion');
    assert.equal(await soundOpacity('.sound-icon'), '0', 'the wait icon replaces the speaker in place');
    assert.deepEqual(await hud.boundingBox(), initialHud, 'sound loading does not move or resize the control bar');
  } finally {
    releaseAudio();
  }
  await page.locator('#sound[aria-pressed=true]:enabled').waitFor();
  assert.equal(await soundOpacity('.sound-wait'), '0', 'the wait icon clears when sound is ready');
  assert.equal(await soundOpacity('.sound-wave'), '1');
  assert.equal(await soundOpacity('.sound-mute'), '0');
  assert.deepEqual(await hud.boundingBox(), initialHud, 'enabling sound keeps the control bar in place');
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
  assert.equal(await soundOpacity('.sound-wave'), '0');
  assert.equal(await soundOpacity('.sound-mute'), '1');
  assert.deepEqual(await hud.boundingBox(), initialHud, 'disabling sound keeps the control bar in place');
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
