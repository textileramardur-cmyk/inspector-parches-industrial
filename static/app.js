(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    video: $('video'), canvas: $('canvas'), sessionCode: $('sessionCode'), statusStrip: $('statusStrip'),
    statusTitle: $('statusTitle'), statusMessage: $('statusMessage'), btnStart: $('btnStart'), btnSaveMaster: $('btnSaveMaster'),
    btnInspect: $('btnInspect'), btnResetMaster: $('btnResetMaster'), btnEvidence: $('btnEvidence'), btnReconnect: $('btnReconnect'),
    sceneScore: $('sceneScore'), patchScore: $('patchScore'), textScore: $('textScore'), stableScore: $('stableScore'),
    deltaX: $('deltaX'), deltaY: $('deltaY'), diagnostic: $('diagnostic'), stepsList: $('stepsList'), strictness: $('strictness'),
    segSensitivity: $('segSensitivity'), showDebug: $('showDebug'), holdLast: $('holdLast')
  };

  const ctx = els.canvas.getContext('2d', { willReadFrequently: true });
  const STORAGE_KEY = 'inspector_v11_master_sample';
  const SESSION_KEY = 'inspector_v11_session_code';

  const state = {
    cameraReady: false,
    running: false,
    mode: 'SETUP', // SETUP | SAMPLE_READY | MASTER_SAVED | INSPECT
    session: getSessionCode(),
    ws: null,
    lastProcess: 0,
    frameMs: 95,
    prevThumb: null,
    history: [],
    telemetryLast: 0,
    lastReading: null,
    lastDecision: null,
    stableReading: null,
    master: loadMaster(),
    lastCanvasDataUrl: null
  };

  els.sessionCode.textContent = state.session;
  if (state.master) {
    state.mode = 'MASTER_SAVED';
    els.btnInspect.disabled = false;
    setStatus('MUESTRA GUARDADA', 'Hay una muestra activa. Puedes inspeccionar o crear una nueva muestra.', 'state-confirm');
  }

  els.btnStart.addEventListener('click', startCamera);
  els.btnSaveMaster.addEventListener('click', saveMasterFromCurrent);
  els.btnInspect.addEventListener('click', () => {
    if (!state.master) return setStatus('SIN MUESTRA', 'Primero guarda una muestra buena.', 'state-adjust');
    state.mode = 'INSPECT';
    updateSteps(4);
    setStatus('INSPECCIONANDO', 'Coloca cada parche dentro de la guía. El sistema esperará lectura estable.', 'state-confirm');
  });
  els.btnResetMaster.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    state.master = null;
    state.mode = 'SETUP';
    state.history = [];
    state.stableReading = null;
    els.btnInspect.disabled = true;
    els.btnSaveMaster.disabled = true;
    updateSteps(1);
    setStatus('NUEVA MUESTRA', 'Coloca un parche bueno para crear una referencia nueva.', 'state-confirm');
  });
  els.btnEvidence.addEventListener('click', saveEvidence);
  els.btnReconnect.addEventListener('click', connectWs);
  els.strictness.addEventListener('change', () => state.history = []);
  els.segSensitivity.addEventListener('input', () => state.history = []);

  connectWs();

  function getSessionCode() {
    let code = localStorage.getItem(SESSION_KEY);
    if (!code) {
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
      const nums = '23456789';
      code = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('') +
        Array.from({ length: 3 }, () => nums[Math.floor(Math.random() * nums.length)]).join('');
      localStorage.setItem(SESSION_KEY, code);
    }
    return code.toUpperCase();
  }

  function loadMaster() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; }
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      els.video.srcObject = stream;
      await els.video.play();
      state.cameraReady = true;
      state.running = true;
      els.btnStart.textContent = 'Cámara activa';
      els.btnStart.disabled = true;
      setStatus('LISTO', state.master ? 'Muestra activa. Coloca un parche para inspeccionar.' : 'Coloca un parche bueno para guardar muestra.', 'state-confirm');
      requestAnimationFrame(loop);
    } catch (err) {
      console.error(err);
      setStatus('ERROR DE CÁMARA', 'No pude abrir la cámara. Revisa permisos del navegador.', 'state-error');
    }
  }

  function connectWs() {
    try { if (state.ws) state.ws.close(); } catch {}
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws/capture/${state.session}`;
    const ws = new WebSocket(url);
    state.ws = ws;
    ws.onopen = () => sendTelemetry({ type: 'system', status: 'CAPTURA CONECTADA', session: state.session }, true);
    ws.onclose = () => setTimeout(() => { if (state.ws === ws) connectWs(); }, 2500);
  }

  function loop(ts) {
    if (!state.running) return;
    drawVideoFrame();
    if (ts - state.lastProcess >= state.frameMs) {
      state.lastProcess = ts;
      try {
        const reading = analyzeFrame(ts);
        state.lastReading = reading;
        updateHistory(reading);
        const decision = decide(reading);
        state.lastDecision = decision;
        updateUI(reading, decision);
        maybeSendTelemetry(reading, decision, ts);
      } catch (err) {
        console.error(err);
        setStatus('ERROR DE LECTURA', 'Algo falló durante el análisis. Reinicia cámara si se repite.', 'state-error');
      }
    }
    // V11: el overlay se dibuja SIEMPRE después del video. Antes se borraba entre frames
    // y por eso parecía que no enmarcaba nada, aunque internamente sí detectaba el parche.
    drawOverlay(state.lastReading, state.lastDecision || { result: 'BUSCANDO', title: 'BUSCANDO', message: 'Coloca el parche dentro de la guía.' });
    requestAnimationFrame(loop);
  }

  function drawVideoFrame() {
    const vw = els.video.videoWidth || 1280;
    const vh = els.video.videoHeight || 720;
    if (els.canvas.width !== vw || els.canvas.height !== vh) {
      els.canvas.width = vw;
      els.canvas.height = vh;
    }
    ctx.drawImage(els.video, 0, 0, els.canvas.width, els.canvas.height);
  }

  function analyzeFrame(ts) {
    const w = els.canvas.width;
    const h = els.canvas.height;
    const image = ctx.getImageData(0, 0, w, h);
    const guide = getGuideRect(w, h);
    const bg = sampleBackground(image, w, h);
    const motion = estimateMotion(image, w, h, guide);
    const scene = scoreScene(bg, motion);
    const patchResult = detectPatch(image, w, h, guide, bg, scene);
    let textResult = null;
    let compare = null;
    if (patchResult) {
      textResult = detectText(image, w, h, patchResult.rect, state.master);
      if (textResult && state.master) compare = compareToMaster(textResult.rect, patchResult.rect, state.master);
    }
    return {
      ts,
      mode: state.mode,
      guide,
      bg,
      motion,
      sceneScore: scene.score,
      sceneReasons: scene.reasons,
      patch: patchResult,
      text: textResult,
      compare,
      master: state.master ? state.master : null
    };
  }

  function getGuideRect(w, h) {
    const gw = w * 0.72;
    const gh = h * 0.68;
    return { x: (w - gw) / 2, y: (h - gh) / 2, w: gw, h: gh };
  }

  function sampleBackground(img, w, h) {
    const d = img.data;
    const size = Math.max(18, Math.floor(Math.min(w, h) * 0.08));
    const corners = [
      [0, 0], [w - size, 0], [0, h - size], [w - size, h - size]
    ];
    let rs = 0, gs = 0, bs = 0, n = 0;
    const lums = [];
    for (const [sx, sy] of corners) {
      for (let y = sy; y < sy + size; y += 4) {
        for (let x = sx; x < sx + size; x += 4) {
          const i = (y * w + x) * 4;
          const r = d[i], g = d[i + 1], b = d[i + 2];
          rs += r; gs += g; bs += b; n++;
          lums.push(luma(r, g, b));
        }
      }
    }
    const r = rs / n, g = gs / n, b = bs / n;
    const meanLum = lums.reduce((a, v) => a + v, 0) / lums.length;
    const variance = lums.reduce((a, v) => a + Math.pow(v - meanLum, 2), 0) / lums.length;
    return { r, g, b, lum: luma(r, g, b), variance: Math.sqrt(variance), chroma: chroma(r, g, b) };
  }

  function estimateMotion(img, w, h, guide) {
    const d = img.data;
    const step = Math.max(12, Math.floor(Math.min(w, h) / 48));
    const vals = [];
    for (let y = Math.floor(guide.y); y < guide.y + guide.h; y += step) {
      for (let x = Math.floor(guide.x); x < guide.x + guide.w; x += step) {
        const i = (y * w + x) * 4;
        vals.push(luma(d[i], d[i + 1], d[i + 2]));
      }
    }
    let diff = 0;
    if (state.prevThumb && state.prevThumb.length === vals.length) {
      for (let i = 0; i < vals.length; i++) diff += Math.abs(vals[i] - state.prevThumb[i]);
      diff /= vals.length;
    }
    state.prevThumb = vals;
    return diff;
  }

  function scoreScene(bg, motion) {
    let score = 100;
    const reasons = [];
    if (bg.variance > 18) { score -= 22; reasons.push('fondo irregular'); }
    if (bg.variance > 28) { score -= 18; reasons.push('fondo con sombras/manchas'); }
    if (motion > 12) { score -= 18; reasons.push('movimiento'); }
    if (motion > 22) { score -= 25; reasons.push('mucho movimiento'); }
    score = clamp(score, 0, 100);
    return { score, reasons };
  }

  function detectPatch(img, w, h, guide, bg, scene) {
    const d = img.data;
    const sens = Number(els.segSensitivity.value); // 20 to 95. Higher means more sensitive.
    const threshold = 112 - sens; // normal 64
    const mask = new Uint8Array(w * h);
    const gx1 = Math.max(0, Math.floor(guide.x - guide.w * 0.08));
    const gy1 = Math.max(0, Math.floor(guide.y - guide.h * 0.08));
    const gx2 = Math.min(w, Math.ceil(guide.x + guide.w * 1.08));
    const gy2 = Math.min(h, Math.ceil(guide.y + guide.h * 1.08));

    for (let y = gy1; y < gy2; y++) {
      for (let x = gx1; x < gx2; x++) {
        const i = (y * w + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const lumDiff = Math.abs(luma(r, g, b) - bg.lum);
        const chromaDiff = Math.abs(chroma(r, g, b) - bg.chroma);
        const colorDistance = colorDist(r, g, b, bg.r, bg.g, bg.b);
        const looksObject = (colorDistance > threshold && (chromaDiff > threshold * 0.32 || lumDiff > threshold * 0.72)) || chromaDiff > threshold * 0.72;
        if (looksObject) mask[y * w + x] = 1;
      }
    }
    morph(mask, w, h, gx1, gy1, gx2, gy2, 2);
    const comps = components(mask, w, h, gx1, gy1, gx2, gy2, 28);
    if (!comps.length) return null;

    const guideCenter = { x: guide.x + guide.w / 2, y: guide.y + guide.h / 2 };
    let best = null;
    let extraArea = 0;
    for (const c of comps) {
      const rw = c.x2 - c.x1 + 1, rh = c.y2 - c.y1 + 1;
      const areaRatio = c.area / (w * h);
      const aspect = rw / Math.max(1, rh);
      const fill = c.area / Math.max(1, rw * rh);
      const cx = c.x1 + rw / 2, cy = c.y1 + rh / 2;
      const centerPenalty = dist(cx, cy, guideCenter.x, guideCenter.y) / Math.max(guide.w, guide.h);
      const borderTouch = c.x1 < 4 || c.y1 < 4 || c.x2 > w - 5 || c.y2 > h - 5;
      const guideOverlap = rectOverlapRatio({ x: c.x1, y: c.y1, w: rw, h: rh }, guide);
      let score = 0;
      if (areaRatio > 0.015 && areaRatio < 0.55 && aspect > 0.35 && aspect < 3.0 && !borderTouch) {
        score = 40 + Math.min(30, areaRatio * 280) + Math.max(0, 20 - centerPenalty * 30) + Math.min(12, fill * 30) + guideOverlap * 18;
      } else {
        extraArea += c.area;
      }
      if (!best || score > best.score) best = { comp: c, score, areaRatio, aspect, fill, centerPenalty, guideOverlap };
    }
    if (!best || best.score < 42) return null;
    const c = best.comp;
    const rect = { x: c.x1, y: c.y1, w: c.x2 - c.x1 + 1, h: c.y2 - c.y1 + 1 };
    const confidence = clamp(best.score - (extraArea > c.area * 0.25 ? 10 : 0) - (scene.score < 65 ? 8 : 0), 0, 100);
    return { rect, confidence, maskArea: c.area, aspect: best.aspect, fill: best.fill };
  }

  function detectText(img, w, h, patchRect, master) {
    // V10: el texto de este tipo de parche suele vivir en la placa inferior.
    // No lo buscamos a ciegas en todo el emblema, porque el escudo de colores genera falsos positivos.
    let zones = [];
    let expectedRect = null;

    if (master && master.textNorm) {
      expectedRect = normToRect(master.textNorm, patchRect);
      const expandX = Math.max(patchRect.w * 0.22, expectedRect.w * 1.05);
      const expandY = Math.max(patchRect.h * 0.18, expectedRect.h * 1.65);
      zones.push({
        name: 'zona esperada por muestra',
        priority: 36,
        rect: {
          x: expectedRect.x - expandX,
          y: expectedRect.y - expandY,
          w: expectedRect.w + expandX * 2,
          h: expectedRect.h + expandY * 2
        },
        expectedRect
      });
    } else {
      // Primer intento: placa inferior, donde en la foto real está el texto.
      zones.push({
        name: 'placa inferior',
        priority: 34,
        rect: {
          x: patchRect.x + patchRect.w * 0.07,
          y: patchRect.y + patchRect.h * 0.52,
          w: patchRect.w * 0.86,
          h: patchRect.h * 0.40
        },
        preferLower: true
      });
      // Segundo intento: zona central baja, por si el parche queda un poco inclinado o la placa varía.
      zones.push({
        name: 'zona central baja',
        priority: 24,
        rect: {
          x: patchRect.x + patchRect.w * 0.10,
          y: patchRect.y + patchRect.h * 0.42,
          w: patchRect.w * 0.80,
          h: patchRect.h * 0.50
        },
        preferLower: true
      });
      // Último intento: interior amplio. Se usa con menos prioridad porque puede confundir detalles del escudo.
      zones.push({
        name: 'interior general',
        priority: 8,
        rect: {
          x: patchRect.x + patchRect.w * 0.08,
          y: patchRect.y + patchRect.h * 0.12,
          w: patchRect.w * 0.84,
          h: patchRect.h * 0.78
        }
      });
    }

    let best = null;
    for (const z of zones) {
      const search = clampRect(z.rect, patchRect, w, h);
      if (search.w < 24 || search.h < 10) continue;
      const cand = findTextCandidateInZone(img, w, patchRect, search, z, expectedRect);
      if (cand && (!best || cand.confidence > best.confidence)) best = cand;
    }
    return best;
  }

  function findTextCandidateInZone(img, w, patchRect, search, zone, expectedRect) {
    const d = img.data;
    const sw = Math.floor(search.w), sh = Math.floor(search.h);
    if (sw < 24 || sh < 10) return null;

    const stats = regionStats(img, w, search);
    const rawMask = new Uint8Array(sw * sh);
    const gray = new Float32Array(sw * sh);
    const localMean = stats.lum;
    const darkThreshold = Math.max(12, Math.min(34, localMean * 0.16));

    for (let yy = 0; yy < sh; yy++) {
      const y = Math.floor(search.y + yy);
      for (let xx = 0; xx < sw; xx++) {
        const x = Math.floor(search.x + xx);
        const i = (y * w + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const lum = luma(r, g, b);
        gray[yy * sw + xx] = lum;
        const cd = colorDist(r, g, b, stats.r, stats.g, stats.b);
        const lumAway = Math.abs(lum - localMean);

        // Señal 1: letras oscuras pequeñas sobre placa clara.
        const darkStroke = lum < localMean - darkThreshold && lum < 158;
        // Señal 2: letras claras u oscuras por diferencia local, útil en bordado con relieve.
        const contrastStroke = cd > 20 || lumAway > 18;
        if (darkStroke || (contrastStroke && lumAway > 14)) rawMask[yy * sw + xx] = 1;
      }
    }

    // Bordes finos: ayuda cuando las letras son pequeñas y la cámara suaviza el trazo.
    for (let yy = 1; yy < sh - 1; yy++) {
      for (let xx = 1; xx < sw - 1; xx++) {
        const gx = Math.abs(gray[yy * sw + xx + 1] - gray[yy * sw + xx - 1]);
        const gy = Math.abs(gray[(yy + 1) * sw + xx] - gray[(yy - 1) * sw + xx]);
        const gsum = gx + gy;
        if (gsum > 24 && gray[yy * sw + xx] < localMean + 10) rawMask[yy * sw + xx] = 1;
      }
    }

    // Une letras y también dos renglones pequeños. Es intencionalmente más generoso que V9.
    dilateRect(rawMask, sw, sh, 8, 2, 2);
    erodeRect(rawMask, sw, sh, 2, 1, 1);

    const comps = components(rawMask, sw, sh, 0, 0, sw, sh, 8);
    let best = null;
    for (const c of comps) {
      const rw = c.x2 - c.x1 + 1, rh = c.y2 - c.y1 + 1;
      const rect = { x: search.x + c.x1, y: search.y + c.y1, w: rw, h: rh };
      const aspect = rw / Math.max(1, rh);
      const areaRel = (rw * rh) / Math.max(1, patchRect.w * patchRect.h);
      const heightRel = rh / patchRect.h;
      const widthRel = rw / patchRect.w;
      const fill = c.area / Math.max(1, rw * rh);
      const touchesSearch = c.x1 < 1 || c.y1 < 1 || c.x2 > sw - 2 || c.y2 > sh - 2;
      const cxNorm = (rect.x + rect.w / 2 - patchRect.x) / patchRect.w;
      const cyNorm = (rect.y + rect.h / 2 - patchRect.y) / patchRect.h;

      let expectedBonus = 0;
      if (expectedRect) {
        const dc = dist(rect.x + rect.w / 2, rect.y + rect.h / 2, expectedRect.x + expectedRect.w / 2, expectedRect.y + expectedRect.h / 2);
        expectedBonus = Math.max(0, 34 - dc / Math.max(1, patchRect.w) * 95);
      } else if (zone.preferLower) {
        expectedBonus = Math.max(0, 20 - Math.abs(cxNorm - 0.5) * 14 - Math.abs(cyNorm - 0.70) * 22);
      } else {
        expectedBonus = Math.max(0, 10 - Math.abs(cxNorm - 0.5) * 10 - Math.abs(cyNorm - 0.60) * 10);
      }

      let score = 0;
      // Texto pequeño real: permitir altura baja. Rechazar bloques enormes del escudo.
      if (aspect > 1.15 && aspect < 22 && heightRel > 0.012 && heightRel < 0.22 && widthRel > 0.055 && widthRel < 0.82 && areaRel < 0.16) {
        score = zone.priority
          + 22
          + Math.min(16, aspect * 1.35)
          + Math.min(18, widthRel * 38)
          + Math.min(12, heightRel * 120)
          + expectedBonus
          + Math.max(0, 10 - Math.abs(fill - 0.42) * 18)
          - (touchesSearch ? 10 : 0);
      }
      if (!best || score > best.score) best = { rect, score, aspect, fill, widthRel, heightRel, search, expectedRect, zoneName: zone.name };
    }

    if (!best || best.score < 43) return null;
    const contrast = textContrast(img, w, best.rect);
    const confidence = clamp(best.score + Math.min(18, contrast / 3.5), 0, 100);
    return { rect: best.rect, confidence, search, expectedRect, aspect: best.aspect, contrast, zoneName: best.zoneName };
  }

  function compareToMaster(textRect, patchRect, master) {
    const now = rectToNorm(textRect, patchRect);
    const ref = master.textNorm;
    const dx = (now.cx - ref.cx) * 100;
    const dy = (now.cy - ref.cy) * 100;
    const dw = (now.w - ref.w) * 100;
    const dh = (now.h - ref.h) * 100;
    return { dx, dy, dw, dh, now, ref };
  }

  function updateHistory(reading) {
    state.history.push(reading);
    if (state.history.length > 18) state.history.shift();
  }

  function decide(reading) {
    const recent = state.history.slice(-15);
    const withPatch = recent.filter(r => r.patch && r.patch.confidence >= 55);
    const withText = recent.filter(r => r.text && r.text.confidence >= 48);
    const stable = stabilityScore(recent);
    const sceneBad = reading.sceneScore < 58;

    let title = 'BUSCANDO';
    let message = 'Coloca el parche dentro de la guía.';
    let cls = 'state-confirm';
    let result = 'BUSCANDO';

    if (!state.cameraReady) {
      return { result: 'SIN_CÁMARA', title: 'SIN CÁMARA', message: 'Inicia la cámara.', cls: 'state-error', stable };
    }
    if (sceneBad) {
      result = 'AJUSTAR_ESCENA';
      title = 'AJUSTAR ESCENA';
      message = reading.sceneReasons?.length ? `Corrige: ${reading.sceneReasons.join(', ')}.` : 'Mejora luz, fondo o estabilidad.';
      cls = 'state-adjust';
    } else if (!reading.patch || reading.patch.confidence < 55) {
      result = 'NO_VEO_PARCHE';
      title = 'NO VEO PARCHE';
      message = 'Colócalo completo dentro de la guía y deja fondo visible alrededor.';
      cls = 'state-adjust';
    } else if (!reading.text || reading.text.confidence < 48) {
      result = 'NO_LEE';
      title = 'NO LEE TEXTO';
      message = 'Parche en azul. Estoy buscando el texto en la zona naranja inferior. Acerca un poco, enfoca y evita sombras.';
      cls = 'state-no-read';
    } else if (withPatch.length < 8 || withText.length < 6 || stable < 60) {
      result = 'CONFIRMANDO';
      title = 'CONFIRMANDO';
      message = 'Mantén el parche quieto un momento.';
      cls = 'state-confirm';
    } else if (!state.master) {
      result = 'MUESTRA_LISTA';
      title = 'MUESTRA LISTA';
      message = 'La lectura está estable. Puedes guardar esta pieza como muestra buena.';
      cls = 'state-ok';
    } else if (state.mode !== 'INSPECT') {
      result = 'MUESTRA_GUARDADA';
      title = 'MUESTRA GUARDADA';
      message = 'Presiona “Inspeccionar producción” cuando quieras empezar.';
      cls = 'state-confirm';
    } else {
      const tol = tolerance();
      const cmp = medianCompare(recent);
      const ok = cmp && Math.abs(cmp.dx) <= tol.x && Math.abs(cmp.dy) <= tol.y;
      if (ok) {
        result = 'OK';
        title = 'OK';
        message = 'Texto alineado contra la muestra buena.';
        cls = 'state-ok';
      } else {
        result = 'REVISAR';
        title = 'REVISAR';
        message = describeDifference(cmp || reading.compare, tol);
        cls = 'state-review';
      }
    }

    const decision = { result, title, message, cls, stable, patchFrames: withPatch.length, textFrames: withText.length };
    if (['OK', 'REVISAR', 'MUESTRA_LISTA'].includes(result)) state.stableReading = { reading, decision };
    return decision;
  }

  function tolerance() {
    const val = els.strictness.value;
    if (val === 'strict') return { x: 3, y: 3 };
    if (val === 'flexible') return { x: 8, y: 8 };
    return { x: 5, y: 5 };
  }

  function stabilityScore(recent) {
    const points = recent.filter(r => r.patch && r.text).map(r => ({
      x: (r.text.rect.x + r.text.rect.w / 2 - r.patch.rect.x) / r.patch.rect.w,
      y: (r.text.rect.y + r.text.rect.h / 2 - r.patch.rect.y) / r.patch.rect.h
    }));
    if (points.length < 3) return 0;
    const mx = points.reduce((a, p) => a + p.x, 0) / points.length;
    const my = points.reduce((a, p) => a + p.y, 0) / points.length;
    const variance = points.reduce((a, p) => a + Math.hypot(p.x - mx, p.y - my), 0) / points.length;
    return clamp(100 - variance * 1800, 0, 100);
  }

  function medianCompare(recent) {
    const comps = recent.filter(r => r.compare).map(r => r.compare);
    if (!comps.length) return null;
    return {
      dx: median(comps.map(c => c.dx)),
      dy: median(comps.map(c => c.dy)),
      dw: median(comps.map(c => c.dw)),
      dh: median(comps.map(c => c.dh))
    };
  }

  function saveMasterFromCurrent() {
    const candidate = state.stableReading?.reading || state.lastReading;
    const decision = state.stableReading?.decision;
    if (!candidate || !candidate.patch || !candidate.text) {
      setStatus('NO HAY MUESTRA', 'Todavía no tengo parche y texto estables.', 'state-adjust');
      return;
    }
    if (decision && !['MUESTRA_LISTA', 'OK'].includes(decision.result) && candidate.text.confidence < 62) {
      setStatus('MUESTRA NO SEGURA', 'Espera una lectura más estable antes de guardar.', 'state-adjust');
      return;
    }
    const master = {
      createdAt: new Date().toISOString(),
      session: state.session,
      textNorm: rectToNorm(candidate.text.rect, candidate.patch.rect),
      patchAspect: candidate.patch.rect.w / Math.max(1, candidate.patch.rect.h),
      textConfidence: candidate.text.confidence,
      patchConfidence: candidate.patch.confidence
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(master));
    state.master = master;
    state.mode = 'MASTER_SAVED';
    state.history = [];
    els.btnInspect.disabled = false;
    els.btnSaveMaster.disabled = true;
    updateSteps(3);
    setStatus('MUESTRA GUARDADA', 'Ahora puedes inspeccionar producción contra esta referencia. El parche queda enmarcado en verde y el texto en naranja.', 'state-ok');
  }

  function drawOverlay(reading, decision) {
    const w = els.canvas.width, h = els.canvas.height;
    const guide = reading?.guide || getGuideRect(w, h);
    ctx.save();

    // Oscurecemos apenas fuera de la guía para que el operador sepa exactamente dónde poner la pieza.
    ctx.fillStyle = 'rgba(15, 23, 42, .12)';
    ctx.fillRect(0, 0, w, h);
    ctx.clearRect(guide.x, guide.y, guide.w, guide.h);

    ctx.lineWidth = Math.max(5, w / 190);
    ctx.setLineDash([18, 10]);
    ctx.strokeStyle = '#2563eb';
    ctx.strokeRect(guide.x, guide.y, guide.w, guide.h);
    ctx.setLineDash([]);
    drawBadge('GUÍA DE TRABAJO', guide.x + 10, guide.y + 12, '#2563eb');

    if (reading?.patch) {
      drawRect(reading.patch.rect, '#00a86b', 'PARCHE DETECTADO', true);

      if (state.master && reading.patch.rect) {
        const exp = normToRect(state.master.textNorm, reading.patch.rect);
        ctx.setLineDash([10, 7]);
        drawRect(exp, '#64748b', 'TEXTO ESPERADO', false);
        ctx.setLineDash([]);
      } else if (!reading.text) {
        const search = lowerTextPreview(reading.patch.rect);
        ctx.setLineDash([12, 7]);
        drawRect(search, '#f97316', 'BUSCO TEXTO AQUÍ', false);
        ctx.setLineDash([]);
      }
    } else {
      drawCenterHint('Coloca el parche completo dentro de la guía azul');
    }

    if (reading?.text) {
      drawRect(reading.text.rect, '#f97316', 'TEXTO LEÍDO', true);
    }

    const panelW = Math.min(w - 24, 760);
    const panelH = Math.max(62, h * 0.095);
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.strokeStyle = '#d0d7e2';
    ctx.lineWidth = 2;
    roundRect(ctx, 12, h - panelH - 12, panelW, panelH, 18, true, true);
    ctx.fillStyle = statusColor(decision.result);
    ctx.font = `900 ${Math.max(24, w / 30)}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(decision.title || 'BUSCANDO', 30, h - panelH + 28);
    ctx.fillStyle = '#475467';
    ctx.font = `800 ${Math.max(14, w / 70)}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(shortMessage(decision.message || ''), 30, h - 23);
    ctx.restore();
  }

  function lowerTextPreview(patch) {
    return {
      x: patch.x + patch.w * 0.08,
      y: patch.y + patch.h * 0.58,
      w: patch.w * 0.84,
      h: patch.h * 0.30
    };
  }

  function drawRect(r, color, label, solid) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = solid ? Math.max(6, els.canvas.width / 170) : Math.max(4, els.canvas.width / 230);
    ctx.shadowColor = 'rgba(0,0,0,.28)';
    ctx.shadowBlur = solid ? 10 : 4;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.shadowBlur = 0;
    drawBadge(label, r.x + 8, Math.max(10, r.y - 34), color);
    ctx.restore();
  }

  function drawBadge(label, x, y, color) {
    ctx.save();
    ctx.font = `900 ${Math.max(15, els.canvas.width / 62)}px system-ui, -apple-system, sans-serif`;
    const padX = 10, padY = 7;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(255,255,255,.95)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, tw + padX * 2, Math.max(30, els.canvas.width / 40), 12, true, true);
    ctx.fillStyle = color;
    ctx.fillText(label, x + padX, y + Math.max(21, els.canvas.width / 55));
    ctx.restore();
  }

  function drawCenterHint(text) {
    ctx.save();
    ctx.font = `900 ${Math.max(22, els.canvas.width / 38)}px system-ui, -apple-system, sans-serif`;
    const tw = ctx.measureText(text).width;
    const x = Math.max(18, (els.canvas.width - tw) / 2 - 16);
    const y = els.canvas.height / 2 - 30;
    ctx.fillStyle = 'rgba(255,255,255,.94)';
    ctx.strokeStyle = '#bfd2ff';
    roundRect(ctx, x, y, Math.min(tw + 32, els.canvas.width - 36), 70, 18, true, true);
    ctx.fillStyle = '#1d4ed8';
    ctx.fillText(text, x + 16, y + 44);
    ctx.restore();
  }

  function shortMessage(msg) {
    const s = String(msg || '');
    return s.length > 72 ? s.slice(0, 69) + '…' : s;
  }

  function statusColor(result) {
    if (result === 'OK' || result === 'MUESTRA_LISTA') return '#16803c';
    if (result === 'REVISAR') return '#b7791f';
    if (result === 'NO_LEE' || result === 'AJUSTAR_ESCENA') return '#1d4ed8';
    return '#344054';
  }

  function updateUI(reading, decision) {
    setStatus(decision.title, decision.message, decision.cls);
    els.sceneScore.textContent = fmtPct(reading.sceneScore);
    els.patchScore.textContent = reading.patch ? fmtPct(reading.patch.confidence) : '--';
    els.textScore.textContent = reading.text ? fmtPct(reading.text.confidence) : '--';
    els.stableScore.textContent = fmtPct(decision.stable || 0);
    const cmp = medianCompare(state.history.slice(-15)) || reading.compare;
    els.deltaX.textContent = cmp ? directionX(cmp.dx) : '--';
    els.deltaY.textContent = cmp ? directionY(cmp.dy) : '--';
    els.diagnostic.textContent = decision.message;
    const canSave = decision.result === 'MUESTRA_LISTA';
    els.btnSaveMaster.disabled = !canSave;
    if (!state.master) {
      if (!reading.patch) els.btnSaveMaster.textContent = 'Esperando parche';
      else if (!reading.text) els.btnSaveMaster.textContent = 'Esperando texto';
      else if (!canSave) els.btnSaveMaster.textContent = 'Confirmando lectura';
      else els.btnSaveMaster.textContent = 'Guardar muestra buena';
    } else {
      els.btnSaveMaster.textContent = 'Muestra guardada';
    }
    if (!state.master && state.cameraReady) updateSteps(decision.result === 'MUESTRA_LISTA' ? 2 : 1);
  }

  function setStatus(title, message, cls) {
    els.statusTitle.textContent = title;
    els.statusMessage.textContent = message;
    els.statusStrip.className = `status-strip ${cls || ''}`;
  }

  function updateSteps(activeIndex) {
    const lis = Array.from(els.stepsList.querySelectorAll('li'));
    lis.forEach((li, i) => li.classList.toggle('active', i === activeIndex));
  }

  function maybeSendTelemetry(reading, decision, ts) {
    if (ts - state.telemetryLast < 250) return;
    state.telemetryLast = ts;
    sendTelemetry(makeTelemetry(reading, decision));
  }

  function makeTelemetry(reading, decision) {
    const cmp = medianCompare(state.history.slice(-15)) || reading.compare;
    const expected = state.master && reading.patch ? normToRect(state.master.textNorm, reading.patch.rect) : null;
    return {
      type: 'telemetry',
      session: state.session,
      version: '11.0.0',
      mode: state.mode,
      result: decision.result,
      title: decision.title,
      message: decision.message,
      sceneScore: round(reading.sceneScore),
      patchScore: reading.patch ? round(reading.patch.confidence) : 0,
      textScore: reading.text ? round(reading.text.confidence) : 0,
      stableScore: round(decision.stable || 0),
      dx: cmp ? round(cmp.dx, 1) : null,
      dy: cmp ? round(cmp.dy, 1) : null,
      patchRect: reading.patch ? normalizeRect(reading.patch.rect, els.canvas.width, els.canvas.height) : null,
      textRect: reading.text ? normalizeRect(reading.text.rect, els.canvas.width, els.canvas.height) : null,
      expectedTextRect: expected ? normalizeRect(expected, els.canvas.width, els.canvas.height) : null,
      timestamp: new Date().toLocaleTimeString()
    };
  }

  function sendTelemetry(payload, force = false) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    try { state.ws.send(JSON.stringify(payload)); } catch {}
  }

  function saveEvidence() {
    const telemetry = state.lastReading ? makeTelemetry(state.lastReading, decide(state.lastReading)) : { message: 'Sin lectura' };
    let screenshot = '';
    try { screenshot = els.canvas.toDataURL('image/jpeg', 0.82); } catch {}
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Evidencia inspección</title><style>body{font-family:Arial;padding:24px}img{max-width:100%;border:1px solid #ccc;border-radius:12px}pre{background:#f3f4f6;padding:16px;border-radius:12px;white-space:pre-wrap}</style></head><body><h1>Evidencia de inspección</h1><p>${new Date().toLocaleString()}</p>${screenshot ? `<img src="${screenshot}" />` : ''}<pre>${escapeHtml(JSON.stringify(telemetry, null, 2))}</pre></body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `evidencia-inspeccion-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- Image utilities ----------
  function luma(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
  function chroma(r, g, b) { const y = luma(r, g, b); return Math.sqrt((r-y)**2 + (g-y)**2 + (b-y)**2); }
  function colorDist(r1, g1, b1, r2, g2, b2) { return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function dist(x1, y1, x2, y2) { return Math.hypot(x1 - x2, y1 - y2); }
  function round(v, d = 0) { const m = 10 ** d; return Math.round((v || 0) * m) / m; }
  function fmtPct(v) { return Number.isFinite(v) ? `${Math.round(v)}%` : '--'; }
  function median(arr) { if (!arr.length) return 0; const s = [...arr].sort((a,b)=>a-b); const m = Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
  function directionX(v) { if (v == null) return '--'; if (Math.abs(v) < 0.6) return 'centrado'; return `${Math.abs(v).toFixed(1)}% ${v > 0 ? 'derecha' : 'izquierda'}`; }
  function directionY(v) { if (v == null) return '--'; if (Math.abs(v) < 0.6) return 'altura correcta'; return `${Math.abs(v).toFixed(1)}% ${v > 0 ? 'abajo' : 'arriba'}`; }
  function describeDifference(cmp, tol) {
    if (!cmp) return 'Lectura fuera de tolerancia. Revisar manualmente.';
    const parts = [];
    if (Math.abs(cmp.dx) > tol.x) parts.push(`texto ${directionX(cmp.dx)}`);
    if (Math.abs(cmp.dy) > tol.y) parts.push(`texto ${directionY(cmp.dy)}`);
    return parts.length ? `Revisar: ${parts.join(' y ')} contra la muestra.` : 'Revisar visualmente.';
  }

  function rectOverlapRatio(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    return inter / Math.max(1, a.w * a.h);
  }

  function clampRect(r, bounds, w, h) {
    const x = clamp(r.x, bounds.x, bounds.x + bounds.w - 1);
    const y = clamp(r.y, bounds.y, bounds.y + bounds.h - 1);
    const x2 = clamp(r.x + r.w, bounds.x + 1, bounds.x + bounds.w);
    const y2 = clamp(r.y + r.h, bounds.y + 1, bounds.y + bounds.h);
    return { x: Math.max(0, x), y: Math.max(0, y), w: Math.min(w, x2) - Math.max(0, x), h: Math.min(h, y2) - Math.max(0, y) };
  }

  function rectToNorm(rect, patch) {
    return {
      cx: (rect.x + rect.w / 2 - patch.x) / patch.w,
      cy: (rect.y + rect.h / 2 - patch.y) / patch.h,
      w: rect.w / patch.w,
      h: rect.h / patch.h
    };
  }
  function normToRect(norm, patch) {
    return {
      x: patch.x + (norm.cx - norm.w / 2) * patch.w,
      y: patch.y + (norm.cy - norm.h / 2) * patch.h,
      w: norm.w * patch.w,
      h: norm.h * patch.h
    };
  }
  function normalizeRect(r, w, h) { return { x: r.x / w, y: r.y / h, w: r.w / w, h: r.h / h }; }

  function regionStats(img, w, rect) {
    const d = img.data;
    const x1 = Math.max(0, Math.floor(rect.x)), y1 = Math.max(0, Math.floor(rect.y));
    const x2 = Math.min(w, Math.ceil(rect.x + rect.w)), y2 = Math.min(Math.floor(img.data.length / 4 / w), Math.ceil(rect.y + rect.h));
    let rs=0, gs=0, bs=0, n=0;
    for (let y = y1; y < y2; y += 3) {
      for (let x = x1; x < x2; x += 3) {
        const i=(y*w+x)*4; rs+=d[i]; gs+=d[i+1]; bs+=d[i+2]; n++;
      }
    }
    const r=rs/Math.max(1,n), g=gs/Math.max(1,n), b=bs/Math.max(1,n);
    return { r, g, b, lum:luma(r,g,b) };
  }

  function textContrast(img, w, rect) {
    const stats = regionStats(img, w, rect);
    return Math.abs(stats.lum - regionStats(img, w, { x: rect.x-rect.w*.2, y: rect.y-rect.h*.2, w: rect.w*1.4, h: rect.h*1.4 }).lum) + 20;
  }

  function morph(mask, w, h, x1, y1, x2, y2, iterations) {
    for (let i=0;i<iterations;i++) dilate(mask,w,h,x1,y1,x2,y2);
    for (let i=0;i<iterations;i++) erode(mask,w,h,x1,y1,x2,y2);
  }
  function dilate(mask,w,h,x1,y1,x2,y2){
    const src = mask.slice();
    for(let y=y1+1;y<y2-1;y++) for(let x=x1+1;x<x2-1;x++){
      const idx=y*w+x;if(src[idx]) continue;
      if(src[idx-1]||src[idx+1]||src[idx-w]||src[idx+w]||src[idx-w-1]||src[idx-w+1]||src[idx+w-1]||src[idx+w+1]) mask[idx]=1;
    }
  }
  function erode(mask,w,h,x1,y1,x2,y2){
    const src = mask.slice();
    for(let y=y1+1;y<y2-1;y++) for(let x=x1+1;x<x2-1;x++){
      const idx=y*w+x;if(!src[idx]) continue;
      if(!(src[idx-1]&&src[idx+1]&&src[idx-w]&&src[idx+w])) mask[idx]=0;
    }
  }
  function dilateRect(mask,w,h,rx,ry,iterations){
    for(let it=0;it<iterations;it++){
      const src=mask.slice();
      for(let y=ry;y<h-ry;y++) for(let x=rx;x<w-rx;x++){
        const idx=y*w+x;if(src[idx]) continue;
        let hit=false;
        for(let yy=-ry;yy<=ry&&!hit;yy++) for(let xx=-rx;xx<=rx;xx++) if(src[(y+yy)*w+x+xx]){hit=true;break;}
        if(hit) mask[idx]=1;
      }
    }
  }
  function erodeRect(mask,w,h,rx,ry,iterations){
    for(let it=0;it<iterations;it++){
      const src=mask.slice();
      for(let y=ry;y<h-ry;y++) for(let x=rx;x<w-rx;x++){
        const idx=y*w+x;if(!src[idx]) continue;
        let ok=true;
        for(let yy=-ry;yy<=ry&&ok;yy++) for(let xx=-rx;xx<=rx;xx++) if(!src[(y+yy)*w+x+xx]){ok=false;break;}
        if(!ok) mask[idx]=0;
      }
    }
  }

  function components(mask, w, h, x1, y1, x2, y2, minArea) {
    const visited = new Uint8Array(w*h);
    const comps = [];
    const qx = [], qy = [];
    for (let y=y1; y<y2; y++) {
      for (let x=x1; x<x2; x++) {
        const start = y*w+x;
        if (!mask[start] || visited[start]) continue;
        let head=0, area=0, minx=x, maxx=x, miny=y, maxy=y;
        qx.length=0; qy.length=0; qx.push(x); qy.push(y); visited[start]=1;
        while(head<qx.length){
          const cx=qx[head], cy=qy[head++]; area++;
          if(cx<minx)minx=cx;if(cx>maxx)maxx=cx;if(cy<miny)miny=cy;if(cy>maxy)maxy=cy;
          const neighbors=[[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]];
          for(const [nx,ny] of neighbors){
            if(nx<x1||nx>=x2||ny<y1||ny>=y2) continue;
            const ni=ny*w+nx;
            if(mask[ni]&&!visited[ni]){visited[ni]=1;qx.push(nx);qy.push(ny);}
          }
        }
        if(area>=minArea) comps.push({area,x1:minx,y1:miny,x2:maxx,y2:maxy});
      }
    }
    comps.sort((a,b)=>b.area-a.area);
    return comps;
  }

  function roundRect(ctx, x, y, w, h, r, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
    if(fill) ctx.fill(); if(stroke) ctx.stroke();
  }

  function escapeHtml(str) { return String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
})();
