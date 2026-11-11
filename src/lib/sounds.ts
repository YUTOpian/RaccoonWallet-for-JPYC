import dingOgg from '../assets/sounds/ding.ogg';
import dingMp3 from '../assets/sounds/ding.mp3';
import ding2Ogg from '../assets/sounds/ding2.ogg';
import ding2Mp3 from '../assets/sounds/ding2.mp3';

// 送金の通知音。送信した時は ding、送金完了は ding2。
// Safari など Ogg Vorbis を再生できない環境では mp3 を使う。
const canPlayOgg =
  typeof Audio !== 'undefined' && new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== '';

const cache = new Map<string, HTMLAudioElement>();

function get(key: string, ogg: string, mp3: string): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  let audio = cache.get(key);
  if (!audio) {
    audio = new Audio(canPlayOgg ? ogg : mp3);
    audio.preload = 'auto';
    cache.set(key, audio);
  }
  return audio;
}

function play(audio: HTMLAudioElement | null) {
  if (!audio) return;
  try {
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  } catch {
    // 音が鳴らなくても送金には影響させない。
  }
}

const sent = () => get('sent', dingOgg, dingMp3);
const completed = () => get('completed', ding2Ogg, ding2Mp3);

/**
 * ブラウザは「ユーザーの操作の中」で一度再生した音声しか、後から自動で鳴らせないことがある
 * (特に iPhone の Safari)。送金完了は操作の何秒~何分も後に鳴るので、ボタンを押した時に
 * 無音で一度だけ再生して「許可」を取っておく。
 */
export function unlockSounds() {
  for (const audio of [sent(), completed()]) {
    if (!audio) continue;
    try {
      audio.muted = true;
      void audio.play().then(
        () => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        },
        () => {
          audio.muted = false;
        },
      );
    } catch {
      audio.muted = false;
    }
  }
}

export const playSentSound = () => play(sent());
export const playCompletedSound = () => play(completed());
