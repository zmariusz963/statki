const AudioEngine = (() => {
  let ctx = null;
  let masterGain = null;
  let musicGain = null;
  let sfxGain = null;
  let convolver = null;
  let muted = false;
  let musicStarted = false;
  let musicTimer = null;
  let player = null;
  let instrumentsReady = false;

  const INSTRUMENT_NAMES = {
    piano: '_tone_0000_FluidR3_GM_sf2_file',
    violin: '_tone_0400_FluidR3_GM_sf2_file',
    cello: '_tone_0420_FluidR3_GM_sf2_file',
    contrabass: '_tone_0430_FluidR3_GM_sf2_file',
    trumpet: '_tone_0560_FluidR3_GM_sf2_file',
    horn: '_tone_0600_FluidR3_GM_sf2_file',
    trombone: '_tone_0570_FluidR3_GM_sf2_file',
    timpani: '_tone_0470_FluidR3_GM_sf2_file',
    accordion: '_tone_0210_FluidR3_GM_sf2_file',
    organ: '_tone_0190_FluidR3_GM_sf2_file',
  };

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

      musicGain = ctx.createGain();
      musicGain.gain.value = 0.05;
      musicGain.connect(masterGain);
      const musicReverbSend = ctx.createGain();
      musicReverbSend.gain.value = 0.4;
      musicGain.connect(musicReverbSend);
      musicReverbSend.connect(convolver);

      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.55;
      sfxGain.connect(masterGain);
      const sfxReverbSend = ctx.createGain();
      sfxReverbSend.gain.value = 0.15;
      sfxGain.connect(sfxReverbSend);
      sfxReverbSend.connect(convolver);

      if (window.WebAudioFontPlayer) {
        player = new window.WebAudioFontPlayer();
      }
    }
    if (ctx.state === 'suspended') ctx.resume();
  }

  function initInstruments(callback) {
    if (!player) {
      callback();
      return;
    }
    const names = Object.values(INSTRUMENT_NAMES);
    names.forEach((name) => {
      if (window[name]) {
        player.loader.decodeAfterLoading(ctx, name);
      }
    });
    setTimeout(() => {
      instrumentsReady = true;
      callback();
    }, 1300);
  }

  function playNote(instrument, when, midiPitch, duration, volume, destination) {
    if (!player || !instrumentsReady) return;
    const preset = window[INSTRUMENT_NAMES[instrument]];
    if (!preset) return;
    player.queueWaveTable(ctx, destination, preset, when, midiPitch, duration, volume);
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

  const scale = [0, 2, 3, 5, 7, 8, 10, 12];
  function midiPitch(semitoneOffset) {
    return 62 + semitoneOffset;
  }

  const melodySeq = [
    [0, 1], [7, 1], [4, 1], [7, 1], [2, 1], [7, 1], [0, 1], [7, 1],
    [0, 1], [7, 1], [4, 1], [7, 1], [2, 1], [7, 1], [0, 1], [7, 1],
    [4, 2], [5, 2], [6, 2], [7, 2],
  ];
  const beatDuration = 0.11;

  function scheduleSlowSection(startTime) {
    const slowNotes = [0, 4, 2, 7, 0, 0];
    const slowBeat = 0.4;
    let t = startTime;
    slowNotes.forEach((idx, i) => {
      const dur = i === slowNotes.length - 1 ? slowBeat * 1.8 : slowBeat;
      playNote('piano', t, midiPitch(scale[idx] - 12), dur * 1.1, 1.1, musicGain);
      playNote('violin', t, midiPitch(scale[idx]), dur * 1.1, 0.7, pannedDestination(musicGain, -0.15));
      if (i % 3 === 0) {
        playNote('cello', t, midiPitch(scale[0] - 12), dur * 1.7, 0.7, musicGain);
      }
      t += dur;
    });
    return t - startTime;
  }

  function scheduleBuildSection(startTime) {
    const buildNotes = [0, 2, 4, 7, 0, 2, 4, 7, 0, 2, 4, 7, 0, 4, 7, 7];
    let beat = 0.32;
    let t = startTime;
    buildNotes.forEach((idx, i) => {
      const intensity = i / buildNotes.length;
      playNote('violin', t, midiPitch(scale[idx] + 12), beat * 1.1, 0.4 + intensity * 0.6, pannedDestination(musicGain, i % 2 === 0 ? -0.3 : 0.3));
      playNote('contrabass', t, midiPitch(scale[0] - 24), beat * 2.2, 0.5 + intensity * 0.4, musicGain);
      playNote('timpani', t, 40, 0.4, 0.5 + intensity * 0.6, musicGain);
      t += beat;
      beat *= 0.955;
    });
    return t - startTime;
  }

  function scheduleFastSection(startTime) {
    const totalDuration = melodySeq.reduce((sum, [, b]) => sum + b * beatDuration, 0);

    playNote('organ', startTime, midiPitch(scale[0] - 24), totalDuration, 0.25, musicGain);

    let t = startTime;
    melodySeq.forEach(([idx, beats], i) => {
      const dur = beats * beatDuration;
      if (idx !== null) {
        playNote('trumpet', t, midiPitch(scale[idx]), dur * 1.3, 1.1, pannedDestination(musicGain, -0.2));
        playNote('trombone', t, midiPitch(scale[idx] - 12), dur * 1.3, 0.9, pannedDestination(musicGain, 0.2));
        playNote('horn', t, midiPitch(scale[idx] - 7), dur * 1.3, 0.7, musicGain);
        playNote('violin', t, midiPitch(scale[idx] + 12), dur * 1.1, 0.4, pannedDestination(musicGain, i % 2 === 0 ? -0.3 : 0.3));
      }
      playNote('timpani', t, 42, 0.35, i % 4 === 0 ? 0.8 : 0.5, musicGain);
      thumpAt(t, musicGain, i % 4 === 0 ? 0.5 : 0.3);
      playNote('contrabass', t, midiPitch(scale[0] - 24), dur * 2, 0.6, musicGain);
      if (i % 4 === 3) {
        playNote('accordion', t, midiPitch(scale[4]), beatDuration * 1.6, 0.6, musicGain);
      }
      t += dur;
    });
    return totalDuration;
  }

  function scheduleMusicLoop() {
    if (!musicStarted) return;
    const startTime = ctx.currentTime + 0.05;
    let t = startTime;
    t += scheduleSlowSection(t);
    t += scheduleBuildSection(t);
    t += scheduleFastSection(t);
    const totalDuration = t - startTime;
    musicTimer = setTimeout(scheduleMusicLoop, totalDuration * 1000);
  }

  function startMusic() {
    ensureCtx();
    if (musicStarted) return;
    musicStarted = true;
    initInstruments(() => {
      if (musicStarted) scheduleMusicLoop();
    });
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
      document.removeEventListener('touchend', start);
    };
    document.addEventListener('click', start);
    document.addEventListener('touchstart', start);
    document.addEventListener('touchend', start);

    const resumeIfSuspended = () => {
      if (ctx && ctx.state === 'suspended') ctx.resume();
    };
    document.addEventListener('click', resumeIfSuspended);
    document.addEventListener('touchend', resumeIfSuspended);
  }
  armFirstInteractionStart();

  return { startMusic, stopMusic, toggleMute, isMuted, playCannonShot, playSplash, playHitImpact, playExplosion };
})();
