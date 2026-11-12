import { CUES } from './loot-bots-arena.mjs?v=2';

const sounds = [
  [CUES.victory, .36, [[392, .12], [494, .12], [587, .13], [784, .23]], .115],
  [CUES.boss, .55, [[110, .17], [98, .19], [147, .32]], .13],
  [CUES.correct, .30, [[440, .11], [554, .11], [740, .22]], .11],
  [CUES.wrong, .35, [[311, .13], [220, .22]], .12],
  [CUES.station, .26, [[264, .13], [396, .21]], .10],
  [CUES.damage, .19, [[137, .17]], .13],
  [CUES.destroy, .09, [[112, .10]], .075],
  [CUES.shield, .16, [[352, .13]], .07],
  [CUES.coin, .11, [[608, .075], [810, .095]], .07],
  [CUES.dash, .13, [[180, .11]], .085],
  [CUES.reload, .17, [[295, .07], [392, .09]], .067],
  [CUES.hit, .09, [[206, .052]], .064],
  [CUES.fire, .10, [[151, .072]], .075],
];

export function createBotsAudio(initial = {}) {
  let effects = initial.effects?.enabled !== false, speech = initial.speech?.enabled !== false;
  let context, output, utterance, next = 0, closed = false;
  const synthesis = window.speechSynthesis;
  const canSpeak = Boolean(synthesis && window.SpeechSynthesisUtterance);
  function unlock() {
    if (!effects || closed) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!context && Audio) {
        context = new Audio(); output = context.createGain();
        output.gain.value = .5; output.connect(context.destination);
      }
      if (context?.state === 'suspended') void context.resume().catch(() => {});
    } catch { /* Sound never delays input. */ }
  }
  function stopSpeech() {
    if (!utterance) return;
    utterance = null;
    try { synthesis.cancel(); } catch { /* Browser speech is optional. */ }
  }
  function say(word) {
    if (!speech || !canSpeak || !/[a-z]/i.test(word || '') || /[\u0600-\u06ff]/.test(word)) return;
    stopSpeech();
    try {
      const current = new window.SpeechSynthesisUtterance(word);
      current.lang = 'en-US'; current.rate = .9;
      const voices = synthesis.getVoices();
      const voice = voices.find(item => item.localService && /^en-US$/i.test(item.lang)) || voices.find(item => /^en\b/i.test(item.lang));
      if (voice) current.voice = voice;
      current.onend = current.onerror = () => { if (utterance === current) utterance = null; };
      utterance = current; synthesis.speak(current);
    } catch { utterance = null; }
  }
  function set(field, enabled) {
    if (field === 'speech') {
      speech = enabled;
      if (!speech) stopSpeech();
    } else {
      effects = enabled;
      if (output) output.gain.setTargetAtTime(effects ? .5 : 0, context.currentTime, .018);
    }
  }
  function play(mask) {
    const important = CUES.victory | CUES.boss | CUES.correct | CUES.wrong;
    if (!mask || !effects || context?.state !== 'running' || (context.currentTime < next && !(mask & important))) return;
    const sound = sounds.find(([bit]) => mask & bit);
    if (!sound) return;
    const [bit, cooldown, notes, volume] = sound;
    let at = context.currentTime;
    next = at + cooldown;
    for (const [frequency, duration] of notes) {
      const oscillator = context.createOscillator(), envelope = context.createGain();
      oscillator.type = bit === CUES.fire || bit === CUES.destroy ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, at);
      if (bit === CUES.fire || bit === CUES.damage || bit === CUES.dash) oscillator.frequency.exponentialRampToValueAtTime(frequency * .57, at + duration);
      envelope.gain.setValueAtTime(.001, at);
      envelope.gain.exponentialRampToValueAtTime(volume, at + .012);
      envelope.gain.exponentialRampToValueAtTime(.001, at + duration);
      oscillator.connect(envelope).connect(output);
      oscillator.start(at); oscillator.stop(at + duration + .008);
      oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
      at += duration * .83;
    }
  }
  return { unlock, say, stopSpeech, set, play, canSpeak, close() {
    closed = true; stopSpeech();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  } };
}
