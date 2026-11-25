const soundButton = document.querySelector('#sound');
const soundError = document.querySelector('#sound-error');
const canvas = document.querySelector('#water');
let audioContext;
let source;
let strokeSource;
let strokeGain;
let strokeTimer;
let lastPointer;
let entryTime = 0;
let stroking = false;
let playing = false;

function stopStroke(immediate = false, resetPointer = true) {
  clearTimeout(strokeTimer);
  if (resetPointer) lastPointer = undefined;
  stroking = false;
  if (!strokeGain) return;
  const now = audioContext.currentTime;
  if (immediate) {
    strokeGain.gain.cancelScheduledValues(now);
    strokeGain.gain.setValueAtTime(0, now);
  } else {
    strokeGain.gain.setTargetAtTime(0, now, 0.06);
  }
}

canvas.addEventListener('pointerenter', (event) => {
  if (event.pointerType !== 'mouse') return;
  lastPointer = { x: event.clientX, y: event.clientY };
  entryTime = performance.now();
});
canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse' || !playing || !strokeGain || document.hidden) return;
  const point = { x: event.clientX, y: event.clientY };
  if (!lastPointer) {
    lastPointer = point;
    return;
  }
  if (performance.now() - entryTime < 180) {
    lastPointer = point;
    return;
  }
  if (Math.hypot(point.x - lastPointer.x, point.y - lastPointer.y) < (stroking ? 1 : 3)) return;
  lastPointer = point;
  if (!stroking) {
    stroking = true;
    strokeGain.gain.setTargetAtTime(0.65, audioContext.currentTime, 0.04);
  }
  clearTimeout(strokeTimer);
  strokeTimer = setTimeout(() => stopStroke(false, false), 220);
});
canvas.addEventListener('pointerleave', () => stopStroke());
window.addEventListener('blur', () => stopStroke());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopStroke();
});

soundButton.addEventListener('click', async () => {
  soundButton.disabled = true;
  try {
    if (!audioContext) {
      if (!window.AudioContext) throw new Error('Web Audio is not supported');
      audioContext = new AudioContext();
    }

    if (playing) {
      stopStroke(true);
      await audioContext.suspend();
      if (audioContext.state !== 'suspended') throw new Error('Audio did not pause');
    } else {
      await audioContext.resume();
      if (audioContext.state !== 'running') throw new Error('Audio did not start');
      if (!source) {
        const response = await fetch(new URL('./assets/water-lake-b-even.wav', import.meta.url));
        if (!response.ok) throw new Error(`Audio request failed: ${response.status}`);
        const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
        const newSource = audioContext.createBufferSource();
        newSource.buffer = buffer;
        newSource.loop = true;
        newSource.connect(audioContext.destination);
        newSource.start();
        source = newSource;
      }
    }
    playing = !playing;
    soundButton.setAttribute('aria-pressed', String(playing));
    soundButton.textContent = playing ? '声音：开' : '声音：关';
    soundError.hidden = true;
    if (playing && !strokeSource) {
      try {
        const response = await fetch(new URL('./assets/paddle-stroke-flow.wav', import.meta.url));
        if (!response.ok) throw new Error(`Paddle audio request failed: ${response.status}`);
        const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
        const newSource = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        newSource.buffer = buffer;
        newSource.loop = true;
        gain.gain.value = 0;
        newSource.connect(gain);
        gain.connect(audioContext.destination);
        newSource.start();
        strokeSource = newSource;
        strokeGain = gain;
      } catch (error) {
        console.error(error);
        soundError.textContent = '划水音效无法加载，请检查网络连接后重新开启声音。';
        soundError.hidden = false;
      }
    }
  } catch (error) {
    console.error(error);
    soundError.textContent = '环境音效无法播放，请检查浏览器的声音设置。';
    soundError.hidden = false;
  } finally {
    soundButton.disabled = false;
  }
});
