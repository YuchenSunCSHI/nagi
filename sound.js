const soundButton = document.querySelector('#sound');
const soundError = document.querySelector('#sound-error');
let audio;
let playing = false;

function showAudioError(error) {
  console.error(error);
  playing = false;
  soundButton.setAttribute('aria-pressed', 'false');
  soundButton.textContent = '声音：关';
  soundError.textContent = '环境音效无法播放，请检查浏览器的声音设置。';
  soundError.hidden = false;
}

soundButton.addEventListener('click', async () => {
  soundButton.disabled = true;
  try {
    if (!audio) {
      audio = new Audio(new URL('./assets/water-lake-b-ai.wav', import.meta.url));
      audio.loop = true;
      audio.preload = 'none';
      audio.addEventListener('error', () => showAudioError(audio.error));
    }

    if (playing) {
      audio.pause();
    } else {
      if (audio.error) audio.load();
      await audio.play();
    }
    playing = !playing;
    soundButton.setAttribute('aria-pressed', String(playing));
    soundButton.textContent = playing ? '声音：开' : '声音：关';
    soundError.hidden = true;
  } catch (error) {
    showAudioError(error);
  } finally {
    soundButton.disabled = false;
  }
});
