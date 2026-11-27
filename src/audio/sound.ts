import type { PointerConsumer } from '../input/pointer';

const soundButton = document.querySelector<HTMLButtonElement>('#sound')!;
const soundError = document.querySelector<HTMLElement>('#sound-error')!;
let audioContext: AudioContext | undefined;
let output: GainNode | undefined;
let sceneAudible = true;
let source: AudioBufferSourceNode | undefined;
let strokeSource: AudioBufferSourceNode | undefined;
let strokeGain: GainNode | undefined;
let strokeTimer: number | undefined;
let lastPointer: { x: number; y: number } | undefined;
let entryTime = 0;
let stroking = false;
let playing = false;
let strokeLoading: Promise<void> | undefined;

export function setLakeAudible(audible: boolean) {
  sceneAudible = audible;
  if (!audible) stopStroke(true);
  if (output && audioContext) output.gain.setValueAtTime(Number(audible), audioContext.currentTime);
}

function audioDownload(url: URL) {
  let pending: Promise<ArrayBuffer> | undefined;
  return {
    load(priority: RequestPriority = 'auto') {
      return pending ??= fetch(url, { priority }).then(response => {
        if (!response.ok) throw new Error(`Audio request failed (${url.pathname}): ${response.status}`);
        return response.arrayBuffer();
      }).catch(error => {
        pending = undefined;
        throw error;
      });
    },
    release() { pending = undefined; }
  };
}

const ambient = audioDownload(new URL('../../assets/behlersee-ambient-loop.flac', import.meta.url));
const stroke = audioDownload(new URL('../../assets/paddle-stroke-flow.wav', import.meta.url));

function setSoundBusy(busy: boolean) {
  soundButton.disabled = busy;
  if (busy) soundButton.setAttribute('aria-busy', 'true');
  else soundButton.removeAttribute('aria-busy');
}

export function prefetchSound() {
  void ambient.load('low').catch(error => {
    console.warn('Unable to prefetch ambient audio', error);
    soundError.textContent = '背景音未能加载，请点「声音」重试。';
    soundError.hidden = false;
  }).finally(() => setSoundBusy(false));
  if (!strokeSource) void stroke.load('low').catch(error => console.warn('Unable to prefetch stroke audio', error));
}

async function loadStroke(context: AudioContext) {
  try {
    const buffer = await context.decodeAudioData(await stroke.load());
    const newSource = context.createBufferSource();
    const gain = context.createGain();
    newSource.buffer = buffer;
    newSource.loop = true;
    gain.gain.value = 0;
    newSource.connect(gain);
    gain.connect(output ?? context.destination);
    newSource.start();
    strokeSource = newSource;
    strokeGain = gain;
  } catch (error) {
    console.error(error);
    if (playing) {
      soundError.textContent = '环境音已开启，划水声未加载。下次开启声音时会重试。';
      soundError.hidden = false;
    }
  } finally {
    stroke.release();
    strokeLoading = undefined;
  }
}

function stopStroke(immediate = false, resetPointer = true) {
  clearTimeout(strokeTimer);
  if (resetPointer) lastPointer = undefined;
  stroking = false;
  if (!strokeGain || !audioContext) return;
  const now = audioContext.currentTime;
  if (immediate) {
    strokeGain.gain.cancelScheduledValues(now);
    strokeGain.gain.setValueAtTime(0, now);
  } else {
    strokeGain.gain.setTargetAtTime(0, now, 0.06);
  }
}

export const soundPointer: PointerConsumer = {
  enter(sample) {
    lastPointer = sample.water ? { x: sample.clientX, y: sample.clientY } : undefined;
    entryTime = sample.now;
  },
  move(sample) {
    if (!playing || !strokeGain || !audioContext || document.hidden) return;
    if (!sample.water) {
      stopStroke();
      return;
    }
    const point = { x: sample.clientX, y: sample.clientY };
    if (!lastPointer || sample.now - entryTime < 180) {
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
  },
  leave: () => stopStroke()
};
window.addEventListener('blur', () => stopStroke());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopStroke();
});

soundButton.addEventListener('click', async () => {
  setSoundBusy(true);
  try {
    if (!audioContext) {
      if (!window.AudioContext) throw new Error('Web Audio is not supported');
      audioContext = new AudioContext();
      output = audioContext.createGain();
      output.gain.value = Number(sceneAudible);
      output.connect(audioContext.destination);
    }

    if (playing) {
      stopStroke(true);
      await audioContext.suspend();
      if (audioContext.state !== 'suspended') throw new Error('Audio did not pause');
    } else {
      await audioContext.resume();
      if (audioContext.state !== 'running') throw new Error('Audio did not start');
      if (!source) {
        const buffer = await audioContext.decodeAudioData(await ambient.load()).finally(ambient.release);
        const newSource = audioContext.createBufferSource();
        newSource.buffer = buffer;
        newSource.loop = true;
        newSource.connect(output ?? audioContext.destination);
        newSource.start();
        source = newSource;
      }
    }
    playing = !playing;
    soundButton.setAttribute('aria-pressed', String(playing));
    soundError.hidden = true;
    if (playing && !strokeSource) strokeLoading ??= loadStroke(audioContext);
  } catch (error) {
    console.error(error);
    soundError.textContent = playing
      ? '声音未能关闭，请再点一次「声音」。'
      : '声音未能开启，请再点一次「声音」重试。';
    soundError.hidden = false;
  } finally {
    setSoundBusy(false);
  }
});
