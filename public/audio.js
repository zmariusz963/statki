const AudioEngine = (() => {
  let ctx = null;
  let masterGain = null;
  let musicGain = null;
  let sfxGain = null;
  let muted = false;
  let musicStarted = false;
  let musicTimer = null;

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.16;
      musicGain.connect(masterGain);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.55;
      sfxGain.connect(masterGain);
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function toneAt(time, freq, duration, gainNode, type, vol) {
    const osc = ctx.createOscillator();
    osc.type = type || 'triangle';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol || 0.5, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(g);
    g.connect(gainNode);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  function thumpAt(time, gainNode, vol) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.5, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
    osc.connect(g);
    g.connect(gainNode);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  const BASE_FREQ = 293.66;
  function freqFromSemitone(n) {
    return BASE_FREQ * Math.pow(2, n / 12);
  }
  const scale = [0, 2, 3, 5, 7, 8, 10, 12];
  const melodySeq = [
    [6, 1], [4, 1], [2, 1], [0, 3],
    [6, 1], [4, 1], [2, 1], [0, 3],
    [7, 1], [7, 1], [6, 1], [4, 2],
    [6, 1], [4, 1], [2, 1], [0, 2],
  ];
  const beatDuration = 0.2;

  function bassToneAt(time, freq, duration, gainNode, vol) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    osc.connect(filter);
    filter.connect(g);
    g.connect(gainNode);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  function scheduleMusicLoop() {
    if (!musicStarted) return;
    const startTime = ctx.currentTime + 0.05;
    let t = startTime;
    melodySeq.forEach(([idx, beats], i) => {
      const dur = beats * beatDuration;
      if (idx !== null) {
        toneAt(t, freqFromSemitone(scale[idx]), dur * 0.9, musicGain, 'triangle', 0.5);
      }
      if (i % 4 === 0) {
        thumpAt(t, musicGain, 0.35);
        bassToneAt(t, freqFromSemitone(scale[0] - 12), beatDuration * 4 * 0.9, musicGain, 0.3);
      }
      t += dur;
    });
    const totalDuration = melodySeq.reduce((sum, [, b]) => sum + b * beatDuration, 0);
    musicTimer = setTimeout(scheduleMusicLoop, totalDuration * 1000);
  }

  function startMusic() {
    ensureCtx();
    if (musicStarted) return;
    musicStarted = true;
    scheduleMusicLoop();
  }

  function stopMusic() {
    musicStarted = false;
    if (musicTimer) clearTimeout(musicTimer);
  }

  function isMuted() {
    return muted;
  }

  function toggleMute() {
    ensureCtx();
    muted = !muted;
    masterGain.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
    return muted;
  }

  function noiseBuffer(duration, shapePower) {
    const size = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, shapePower);
    }
    return buffer;
  }

  function playCannonShot() {
    ensureCtx();
    const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(0.3, 2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    noise.connect(filter);
    filter.connect(g);
    g.connect(sfxGain);
    noise.start(t);
    thumpAt(t, sfxGain, 0.7);
  }

  function playSplash() {
    ensureCtx();
    const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(0.25, 1.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    noise.connect(filter);
    filter.connect(g);
    g.connect(sfxGain);
    noise.start(t);
  }

  function playHitImpact() {
    ensureCtx();
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.45, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g);
    g.connect(sfxGain);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  function playExplosion() {
    ensureCtx();
    const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(0.6, 1.2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1000, t);
    filter.frequency.exponentialRampToValueAtTime(150, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    noise.connect(filter);
    filter.connect(g);
    g.connect(sfxGain);
    noise.start(t);
    thumpAt(t, sfxGain, 1);
  }

  function armFirstInteractionStart() {
    const start = () => {
      startMusic();
      document.removeEventListener('click', start);
      document.removeEventListener('touchstart', start);
    };
    document.addEventListener('click', start);
    document.addEventListener('touchstart', start);
  }
  armFirstInteractionStart();

  return { startMusic, stopMusic, toggleMute, isMuted, playCannonShot, playSplash, playHitImpact, playExplosion };
})();
