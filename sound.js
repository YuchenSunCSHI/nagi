const soundButton = document.querySelector('#sound');
const soundError = document.querySelector('#sound-error');
let audioContext;
let source;
let playing = false;

soundButton.addEventListener('click', async () => {
  soundButton.disabled = true;
  try {
    if (!audioContext) {
      if (!window.AudioContext) throw new Error('Web Audio is not supported');
      audioContext = new AudioContext();
    }

    if (playing) {
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
  } catch (error) {
    console.error(error);
    soundError.textContent = '环境音效无法播放，请检查浏览器的声音设置。';
    soundError.hidden = false;
  } finally {
    soundButton.disabled = false;
  }
});
