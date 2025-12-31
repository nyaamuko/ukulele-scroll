// engine/engine.js
// Ukeflow Engine (v22 logic extracted)
// - UI/DOMから分離：時間進行 / 譜面生成 / 判定 / token座標計算 を担当
// - DOM生成・見た目は adapter 側（app.js）で扱う

(function (global) {
  "use strict";

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function createEngine(adapter) {
    if (!adapter) throw new Error("Engine adapter is required.");

    // ---- state ----
    let running = false;
    let paused = false;

    let score = 0;
    let combo = 0;

    let rafId = null;
    let lastTs = 0;
    let songPosMs = 0;

    let bpm = 90;
    let flowSpeed = 1.0;
    let hitWindowMs = 140;
    let beatMs = 60000 / bpm;

    // scoreData = [{chord, beats}]
    let scoreData = [];
    let stepIdx = 0;
    let nextSpawnBeat = 0;
    let spawnAheadBeats = 3.0;

    // {id, chord, targetTimeMs, hit, tokens:[]}
    let chordEvents = [];
    let nextEventId = 1;

    let tokens = [];
    let nowReady = false;

    function setHUD() {
      adapter.onHUD?.({ score, combo, bpm, running, paused });
    }

    function setRun(on) {
      adapter.onRun?.(on);
    }

    function showFloat(text) {
      adapter.onFloat?.(text);
    }

    function setNextChordLabel() {
      const step = scoreData[stepIdx % scoreData.length];
      adapter.onNextChord?.(step?.chord || "-");
    }

    function judge(deltaMs) {
      const ad = Math.abs(deltaMs);
      if (ad <= hitWindowMs * 0.45) return "PERFECT";
      if (ad <= hitWindowMs * 0.85) return "GREAT";
      if (ad <= hitWindowMs) return "OK";
      return "MISS";
    }

    function award(result) {
      if (result === "PERFECT") {
        score += 300;
        combo += 1;
        showFloat("PERFECT✨");
      } else if (result === "GREAT") {
        score += 200;
        combo += 1;
        showFloat("GREAT!");
      } else if (result === "OK") {
        score += 120;
        combo += 1;
        showFloat("OK");
      } else {
        combo = 0;
        showFloat("MISS…");
      }
      setHUD();
    }

    function spawnChordEvent(chord, beatAt) {
      const def = adapter.getChordDef?.(chord);
      if (!def) return;

      const targetTimeMs = beatAt * beatMs;
      const ev = { id: nextEventId++, chord, targetTimeMs, hit: false, tokens: [] };
      chordEvents.push(ev);

      const travelMs = (beatMs * spawnAheadBeats) / flowSpeed;

      for (let laneIndex = 0; laneIndex < 4; laneIndex++) {
        const fret = def.frets[laneIndex];
        const finger = def.fingers[laneIndex];
        if (!fret || fret <= 0) continue;

        const token = adapter.spawnToken?.({
          laneIndex,
          fret,
          finger,
          chord,
          chordEventId: ev.id,
          targetTimeMs,
          travelMs,
        });

        if (!token) continue;

        token.laneIndex = laneIndex;
        token.targetTimeMs = targetTimeMs;
        token.travelMs = travelMs;
        token.hit = false;
        token.ready = false;

        tokens.push(token);
        ev.tokens.push(token);
      }
    }

    function strum() {
      adapter.onFlashPads?.();

      if (!running || paused) {
        showFloat("STRUM");
        return;
      }

      const nowMs = songPosMs;

      let best = null;
      let bestAbs = Infinity;

      for (const ev of chordEvents) {
        if (ev.hit) continue;
        const delta = nowMs - ev.targetTimeMs;
        const ad = Math.abs(delta);
        if (ad < bestAbs) {
          bestAbs = ad;
          best = { ev, delta };
        }
      }

      if (!best) {
        award("MISS");
        return;
      }

      const res = judge(best.delta);
      if (res === "MISS") {
        award("MISS");
        return;
      }

      best.ev.hit = true;

      for (const t of best.ev.tokens) {
        t.hit = true;
        t.ready = false;
        adapter.onTokenHit?.(t);
      }

      award(res);
      setNextChordLabel();
    }

    function stopLoop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      lastTs = 0;
    }

    function startLoop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
    }

    function tick(ts) {
      if (!running) return;
      if (paused) {
        stopLoop();
        return;
      }

      if (!lastTs) lastTs = ts;
      const dt = ts - lastTs;
      lastTs = ts;
      songPosMs += dt;

      const currentBeat = songPosMs / beatMs;

      while (nextSpawnBeat <= currentBeat + spawnAheadBeats) {
        const step = scoreData[stepIdx % scoreData.length];
        const chord = step?.chord;
        const beats = clamp(parseFloat(step?.beats ?? 2), 0.5, 16);

        spawnChordEvent(chord, nextSpawnBeat + spawnAheadBeats);

        stepIdx++;
        nextSpawnBeat += beats;
        setNextChordLabel();
      }

      nowReady = false;

      for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i];
        if (!adapter.isTokenAlive?.(t)) {
          tokens.splice(i, 1);
          continue;
        }

        const timeToTarget = t.targetTimeMs - songPosMs;
        const p = 1 - timeToTarget / t.travelMs;
        const xBase = t.startX + p * (t.targetX - t.startX);
        const x = xBase + (1 - p) * (t.fretOffset || 0);

        adapter.renderToken?.(t, x);

        const near = Math.abs(x - adapter.HIT_X) <= 10;

        if (!t.hit && near) {
          nowReady = true;
          if (!t.ready) {
            t.ready = true;
            adapter.onTokenReady?.(t, true);
          }
        } else {
          if (t.ready) {
            t.ready = false;
            adapter.onTokenReady?.(t, false);
          }
        }

        if (!t.hit && x < adapter.HIT_X - 120) {
          t.hit = true;
          t.ready = false;
          adapter.onTokenMiss?.(t);
        }

        if (t.hit && x < adapter.HIT_X - 170) {
          adapter.removeToken?.(t);
          tokens.splice(i, 1);
        }
      }

      adapter.onNowReady?.(nowReady);

      rafId = requestAnimationFrame(tick);
    }

    function reset(settings) {
      stopLoop();
      running = false;
      paused = false;

      score = 0;
      combo = 0;

      bpm = clamp(parseInt(settings?.bpm ?? 90, 10), 60, 200);
      beatMs = 60000 / bpm;

      flowSpeed = clamp(parseFloat(settings?.flowSpeed ?? 1.0), 0.7, 1.8);
      hitWindowMs = clamp(parseInt(settings?.hitWindowMs ?? 140, 10), 60, 280);

      scoreData = (settings?.scoreData || []).slice();
      if (!scoreData.length) scoreData = adapter.getDefaultScoreData?.() || [];

      stepIdx = 0;
      nextSpawnBeat = 0;

      chordEvents = [];
      nextEventId = 1;

      for (const t of tokens) adapter.removeToken?.(t);
      tokens = [];

      songPosMs = 0;
      nowReady = false;

      setHUD();
      setRun(false);
      setNextChordLabel();
      showFloat("READY!");
    }

    function start() {
      if (running) return;
      running = true;
      paused = false;
      lastTs = 0;
      setHUD();
      setRun(true);
      showFloat("START!");
      startLoop();
    }

    function togglePause() {
      if (!running) return;
      paused = !paused;
      setHUD();
      setRun(running && !paused);

      if (!paused) {
        lastTs = performance.now();
        startLoop();
      } else {
        stopLoop();
      }
    }

    function handleInput(action) {
      if (!action || !action.type) return;

      if (action.type === "STRUM") return strum();
      if (action.type === "START") return start();
      if (action.type === "PAUSE_TOGGLE") return togglePause();
    }

    return {
      reset,
      start,
      togglePause,
      handleInput,
      getSongPosMs: () => songPosMs,
      isRunning: () => running,
      isPaused: () => paused,
      getBpm: () => bpm,
      _debug: () => ({
        bpm,
        flowSpeed,
        hitWindowMs,
        beatMs,
        score,
        combo,
        stepIdx,
        nextSpawnBeat,
        spawnAheadBeats,
        tokensCount: tokens.length,
        eventsCount: chordEvents.length,
      }),
    };
  }

  global.UkeflowEngine = { createEngine };
})(window);
