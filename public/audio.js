const AudioEngine = (() => {
  let ctx = null;
  let masterGain = null;
  let sfxGain = null;
  let convolver = null;
  let muted = false;
  let musicStarted = false;
  const bgMusic = document.getElementById('bg-music');

  function pannedDestination(gainNode, pan) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(gainNode);
    return panner;
  }

  function createReverbImpulse(duration, decay) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(ctx.destination);

      convolver = ctx.createConvolver();
      convolver.buffer = createReverbImpulse(2.4, 2.2);
      const reverbReturn = ctx.createGain();
      reverbReturn.gain.value = 0.9;
      convolver.connect(reverbReturn);
      reverbReturn.connect(masterGain);

      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.55;
      sfxGain.connect(masterGain);
      const sfxReverbSend = ctx.createGain();
      sfxReverbSend.gain.value = 0.15;
      sfxGain.connect(sfxReverbSend);
      sfxReverbSend.connect(convolver);
    }
    if (ctx.state === 'suspended') ctx.resume();
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

  function startMusic() {
    ensureCtx();
    if (musicStarted || !bgMusic) return;
    musicStarted = true;
    bgMusic.volume = 0.35;
    bgMusic.muted = muted;
    bgMusic.play().catch(() => {});
  }

  function stopMusic() {
    musicStarted = false;
    if (bgMusic) bgMusic.pause();
  }

  function isMuted() {
    return muted;
  }

  function toggleMute() {
    ensureCtx();
    muted = !muted;
    masterGain.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
    if (bgMusic) bgMusic.muted = muted;
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
      document.removeEventListener('touchend', start);
    };
    document.addEventListener('click', start);
    document.addEventListener('touchstart', start);
    document.addEventListener('touchend', start);

    const resumeIfSuspended = () => {
      if (ctx && ctx.state === 'suspended') ctx.resume();
      if (bgMusic && bgMusic.paused && musicStarted) bgMusic.play().catch(() => {});
    };
    document.addEventListener('click', resumeIfSuspended);
    document.addEventListener('touchend', resumeIfSuspended);
  }
  armFirstInteractionStart();

  return { startMusic, stopMusic, toggleMute, isMuted, playCannonShot, playSplash, playHitImpact, playExplosion };
})();
