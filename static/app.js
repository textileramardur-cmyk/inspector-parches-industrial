(() => {
  'use strict';

  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  const els = {
    sessionCode: document.getElementById('sessionCode'),
    manualCode: document.getElementById('manualCode'),
    connectButton: document.getElementById('connectButton'),
    startButton: document.getElementById('startButton'),
    statusCard: document.getElementById('statusCard'),
    statusText: document.getElementById('statusText'),
    dxText: document.getElementById('dxText'),
    dyText: document.getElementById('dyText'),
    angleText: document.getElementById('angleText'),
    scoreText: document.getElementById('scoreText'),
    scoreBar: document.getElementById('scoreBar'),
    hintText: document.getElementById('hintText'),
    tolX: document.getElementById('tolX'),
    tolY: document.getElementById('tolY'),
    tolAngle: document.getElementById('tolAngle'),
    minScore: document.getElementById('minScore'),
    tolXLabel: document.getElementById('tolXLabel'),
    tolYLabel: document.getElementById('tolYLabel'),
    tolAngleLabel: document.getElementById('tolAngleLabel'),
    minScoreLabel: document.getElementById('minScoreLabel'),
  };

  const state = {
    code: null,
    ws: null,
    cvReady: false,
    cameraReady: false,
    lastSend: 0,
    lastFrameAt: 0,
    fps: 0,
    pxPerMm: null,
    smoothed: null,
    history: [],
    lastGoodCalibration: null,
    running: false,
  };

  const COLORS = {
    ok: '#138a42',
    bad: '#c62828',
    warn: '#b26a00',
    cyan: '#0f8f88',
    ink: '#0b1f33',
    white: '#ffffff',
  };

  function getTolerances() {
    return {
      xMm: Number(els.tolX.value),
      yMm: Number(els.tolY.value),
      angleDeg: Number(els.tolAngle.value),
      minScore: Number(els.minScore.value),
    };
  }

  function updateToleranceLabels() {
    const t = getTolerances();
    els.tolXLabel.textContent = `${t.xMm.toFixed(1)} mm`;
    els.tolYLabel.textContent = `${t.yMm.toFixed(1)} mm`;
    els.tolAngleLabel.textContent = `${t.angleDeg.toFixed(0)}°`;
    els.minScoreLabel.textContent = `${t.minScore.toFixed(0)}%`;
  }

  function randomCode() {
    const letters = Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
    const digits = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    return `${letters}${digits}`;
  }

  function cleanCode(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  async function createSession() {
    try {
      const res = await fetch('/api/session', { method: 'POST' });
      if (!res.ok) throw new Error('No session');
      const data = await res.json();
      return data.code;
    } catch (_) {
      return randomCode();
    }
  }

  function wsBaseUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  }

  function connectCaptureSocket(code) {
    const clean = cleanCode(code);
    if (!/^[A-Z]{3}[0-9]{3}$/.test(clean)) {
      setHint('El código debe tener formato ABC123. Tres letras y tres números. Civilización básica, pero útil.');
      return;
    }
    state.code = clean;
    els.sessionCode.textContent = clean;
    els.manualCode.value = clean;

    if (state.ws) {
      try { state.ws.close(); } catch (_) {}
    }

    const ws = new WebSocket(`${wsBaseUrl()}/ws/capture/${clean}`);
    state.ws = ws;

    ws.addEventListener('open', () => setHint(`Sesión ${clean} vinculada. Abre /monitor en la PC y usa ese código.`));
    ws.addEventListener('close', () => setHint('WebSocket desconectado. Si Render estaba dormido, vuelve a vincular. Porque hasta los servidores toman siesta.'));
    ws.addEventListener('error', () => setHint('Error de WebSocket. Revisa que estés en HTTPS/Render y que el servicio esté activo.'));
  }

  function setHint(message) {
    els.hintText.innerHTML = message;
  }

  async function waitForOpenCv() {
    if (window.cv && window.OPENCV_READY) return;
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        if (window.cv && window.OPENCV_READY) {
          clearInterval(timer);
          resolve();
        }
      }, 80);
      window.addEventListener('opencv-ready', () => {
        clearInterval(timer);
        resolve();
      }, { once: true });
    });
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setUiStatus({ status: 'INESTABLE', message: 'La cámara requiere HTTPS o localhost.' });
      return;
    }

    await waitForOpenCv();
    state.cvReady = true;

    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 },
      },
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      state.cameraReady = true;
      state.running = true;
      els.startButton.textContent = 'Cámara activa';
      els.startButton.disabled = true;
      loop();
    } catch (err) {
      setUiStatus({ status: 'INESTABLE', message: `No se pudo abrir cámara: ${err.name || err.message}` });
    }
  }

  function fitCanvasToVideo() {
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 720;
    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }
  }

  function loop(now = performance.now()) {
    if (!state.running) return;
    requestAnimationFrame(loop);
    if (!state.cameraReady || !state.cvReady) return;

    // Procesamiento máximo aproximado 20 fps para no cocinar el iPhone como sandwichera industrial.
    if (now - state.lastFrameAt < 50) return;
    const dt = now - state.lastFrameAt;
    state.lastFrameAt = now;
    state.fps = dt > 0 ? Math.round(1000 / dt) : 0;

    fitCanvasToVideo();
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    let analysis;
    try {
      analysis = analyzeFrame(canvas);
    } catch (err) {
      console.error(err);
      analysis = { status: 'INESTABLE', message: 'Error interno de análisis', frame: { w: canvas.width, h: canvas.height } };
    }

    drawOverlay(analysis);
    setUiStatus(analysis);
    maybeSend(analysis, now);
  }

  function analyzeFrame(sourceCanvas) {
    const cv = window.cv;
    const src = cv.imread(sourceCanvas);
    const gray = new cv.Mat();
    const blurred = new cv.Mat();

    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

      const calibration = detectCalibration(blurred, sourceCanvas.width, sourceCanvas.height);
      if (calibration) {
        state.lastGoodCalibration = calibration;
        state.pxPerMm = calibration.pxPerMm;
      }

      const activeCalibration = calibration || state.lastGoodCalibration;
      const pxPerMm = activeCalibration?.pxPerMm || null;
      const patch = detectPatch(blurred, activeCalibration, sourceCanvas.width, sourceCanvas.height);
      const text = patch ? detectText(blurred, patch) : null;

      let result = {
        type: 'metrics',
        frame: { w: sourceCanvas.width, h: sourceCanvas.height, fps: state.fps },
        calibration: activeCalibration,
        patch,
        text,
        pxPerMm,
        status: 'INESTABLE',
        message: 'Buscando patrón, parche y texto',
        tolerance: getTolerances(),
        ts: Date.now(),
      };

      if (!pxPerMm) {
        result.message = 'No se detecta tarjeta negra 5×5 cm';
        return result;
      }
      if (!patch) {
        result.message = 'No se detecta contorno estable de parche';
        return result;
      }
      if (!text) {
        result.message = 'No se detecta bloque de texto dentro del parche';
        return result;
      }

      const dxMm = (text.center.x - patch.center.x) / pxPerMm;
      const dyMm = (text.center.y - patch.center.y) / pxPerMm;
      const relativeAngle = normalizeAngle(text.angle - patch.angle);
      const scored = scoreInspection(dxMm, dyMm, relativeAngle, getTolerances());

      const rawMetrics = { dxMm, dyMm, angleDeg: relativeAngle, score: scored.score };
      const smooth = smoothMetrics(rawMetrics);
      const stable = isStable(smooth);

      result.metrics = smooth;
      result.status = !stable ? 'INESTABLE' : (scored.pass ? 'OK' : 'MAL');
      result.message = !stable ? 'Medición aún inestable' : scored.message;
      result.stable = stable;
      return result;
    } finally {
      src.delete();
      gray.delete();
      blurred.delete();
    }
  }

  function detectCalibration(gray, width, height) {
    const cv = window.cv;
    const mask = new cv.Mat();
    const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const frameArea = width * height;
    let best = null;

    try {
      cv.threshold(gray, mask, 75, 255, cv.THRESH_BINARY_INV);
      cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const approx = new cv.Mat();
        try {
          const area = cv.contourArea(cnt);
          if (area < frameArea * 0.004 || area > frameArea * 0.45) continue;
          const peri = cv.arcLength(cnt, true);
          cv.approxPolyDP(cnt, approx, peri * 0.025, true);
          if (approx.rows !== 4) continue;

          const rect = cv.minAreaRect(cnt);
          const w = Math.max(rect.size.width, 1);
          const h = Math.max(rect.size.height, 1);
          const aspect = Math.max(w, h) / Math.min(w, h);
          if (aspect > 1.22) continue;

          const boxArea = w * h;
          const fill = area / boxArea;
          if (fill < 0.65) continue;

          const pxPerMm = ((w + h) / 2) / 50.0;
          if (pxPerMm < 2 || pxPerMm > 40) continue;

          const candidate = {
            kind: 'inner_5x5',
            center: { x: rect.center.x, y: rect.center.y },
            size: { w: rect.size.width, h: rect.size.height },
            angle: normalizeRectAngle(rect),
            pxPerMm,
            bbox: rectToBbox(rect),
            quality: area * (1 / aspect) * fill,
            rect: serializeRotatedRect(rect),
          };
          if (!best || candidate.quality > best.quality) best = candidate;
        } finally {
          approx.delete();
          cnt.delete();
        }
      }
      return best;
    } finally {
      mask.delete();
      kernel.delete();
      contours.delete();
      hierarchy.delete();
    }
  }

  function detectPatch(gray, calibration, width, height) {
    const cv = window.cv;
    const edges = new cv.Mat();
    const kernel = cv.Mat.ones(7, 7, cv.CV_8U);
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const frameArea = width * height;
    let best = null;

    try {
      cv.Canny(gray, edges, 45, 135, 3, false);
      cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 1);
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const centerBias = { x: width * 0.5, y: height * 0.5 };

      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        try {
          const area = cv.contourArea(cnt);
          if (area < frameArea * 0.006 || area > frameArea * 0.70) continue;
          const rect = cv.minAreaRect(cnt);
          const bbox = rectToBbox(rect);
          if (calibration && overlapRatio(bbox, calibration.bbox) > 0.35) continue;

          const rw = Math.max(rect.size.width, 1);
          const rh = Math.max(rect.size.height, 1);
          const aspect = Math.max(rw, rh) / Math.min(rw, rh);
          if (aspect > 5.0) continue;

          const dist = Math.hypot(rect.center.x - centerBias.x, rect.center.y - centerBias.y);
          const centrality = 1 - Math.min(1, dist / Math.hypot(width, height));
          const score = area * (0.55 + centrality * 0.45);

          const candidate = {
            center: { x: rect.center.x, y: rect.center.y },
            size: { w: rect.size.width, h: rect.size.height },
            angle: normalizeRectAngle(rect),
            bbox,
            area,
            rect: serializeRotatedRect(rect),
            score,
          };
          if (!best || candidate.score > best.score) best = candidate;
        } finally {
          cnt.delete();
        }
      }
      return best;
    } finally {
      edges.delete();
      kernel.delete();
      contours.delete();
      hierarchy.delete();
    }
  }

  function detectText(gray, patch) {
    const cv = window.cv;
    const inset = 0.13;
    const r = patch.bbox;
    const x = Math.max(0, Math.round(r.x + r.w * inset));
    const y = Math.max(0, Math.round(r.y + r.h * inset));
    const w = Math.max(10, Math.round(r.w * (1 - inset * 2)));
    const h = Math.max(10, Math.round(r.h * (1 - inset * 2)));
    const safeW = Math.min(w, gray.cols - x);
    const safeH = Math.min(h, gray.rows - y);
    if (safeW < 20 || safeH < 20) return null;

    const roiRect = new cv.Rect(x, y, safeW, safeH);
    const roi = gray.roi(roiRect);
    const eq = new cv.Mat();
    const edges = new cv.Mat();
    const kernel = cv.Mat.ones(3, 9, cv.CV_8U);
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    let union = null;
    let totalArea = 0;
    let biggestRect = null;

    try {
      cv.equalizeHist(roi, eq);
      cv.Canny(eq, edges, 35, 115, 3, false);
      cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 1);
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 1);
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const roiArea = safeW * safeH;
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        try {
          const rect = cv.boundingRect(cnt);
          const area = rect.width * rect.height;
          if (area < roiArea * 0.002 || area > roiArea * 0.55) continue;
          if (rect.width < 6 || rect.height < 4) continue;
          if (rect.y <= 2 || rect.y + rect.height >= safeH - 2) continue;
          if (rect.x <= 2 || rect.x + rect.width >= safeW - 2) continue;

          const globalRect = {
            x: x + rect.x,
            y: y + rect.y,
            w: rect.width,
            h: rect.height,
          };
          union = union ? unionRects(union, globalRect) : globalRect;
          totalArea += area;
          if (!biggestRect || area > biggestRect.area) biggestRect = { ...globalRect, area };
        } finally {
          cnt.delete();
        }
      }

      if (!union || totalArea < roiArea * 0.004) return null;

      const m = cv.moments(edges, true);
      let angle = 0;
      if (Math.abs(m.mu20 - m.mu02) + Math.abs(m.mu11) > 1e-6) {
        angle = 0.5 * Math.atan2(2 * m.mu11, m.mu20 - m.mu02) * 180 / Math.PI;
      }

      return {
        center: { x: union.x + union.w / 2, y: union.y + union.h / 2 },
        bbox: union,
        angle: normalizeAngle(angle),
        area: totalArea,
        main: biggestRect,
      };
    } finally {
      roi.delete();
      eq.delete();
      edges.delete();
      kernel.delete();
      contours.delete();
      hierarchy.delete();
    }
  }

  function scoreInspection(dxMm, dyMm, angleDeg, tolerance) {
    const sx = Math.max(0, 1 - Math.abs(dxMm) / tolerance.xMm);
    const sy = Math.max(0, 1 - Math.abs(dyMm) / tolerance.yMm);
    const sa = Math.max(0, 1 - Math.abs(angleDeg) / tolerance.angleDeg);
    const score = Math.round((sx * 0.4 + sy * 0.4 + sa * 0.2) * 100);
    const pass = Math.abs(dxMm) <= tolerance.xMm &&
      Math.abs(dyMm) <= tolerance.yMm &&
      Math.abs(angleDeg) <= tolerance.angleDeg &&
      score >= tolerance.minScore;

    let message = pass ? 'Dentro de tolerancia' : 'Fuera de tolerancia';
    if (!pass) {
      const reasons = [];
      if (Math.abs(dxMm) > tolerance.xMm) reasons.push(`X ${dxMm.toFixed(1)} mm`);
      if (Math.abs(dyMm) > tolerance.yMm) reasons.push(`Y ${dyMm.toFixed(1)} mm`);
      if (Math.abs(angleDeg) > tolerance.angleDeg) reasons.push(`ángulo ${angleDeg.toFixed(1)}°`);
      if (score < tolerance.minScore) reasons.push(`score ${score}%`);
      message = reasons.join(' · ');
    }
    return { score, pass, message };
  }

  function smoothMetrics(raw) {
    if (!state.smoothed) {
      state.smoothed = { ...raw };
    } else {
      const a = 0.35;
      state.smoothed.dxMm = lerp(state.smoothed.dxMm, raw.dxMm, a);
      state.smoothed.dyMm = lerp(state.smoothed.dyMm, raw.dyMm, a);
      state.smoothed.angleDeg = lerpAngle(state.smoothed.angleDeg, raw.angleDeg, a);
      state.smoothed.score = Math.round(lerp(state.smoothed.score, raw.score, a));
    }
    state.history.push({ ...state.smoothed, t: Date.now() });
    state.history = state.history.slice(-6);
    return { ...state.smoothed };
  }

  function isStable(metrics) {
    if (!metrics || state.history.length < 4) return false;
    const xs = state.history.map(v => v.dxMm);
    const ys = state.history.map(v => v.dyMm);
    const as = state.history.map(v => v.angleDeg);
    return (Math.max(...xs) - Math.min(...xs) < 1.8) &&
      (Math.max(...ys) - Math.min(...ys) < 1.8) &&
      (Math.max(...as) - Math.min(...as) < 3.0);
  }

  function setUiStatus(analysis) {
    const m = analysis.metrics;
    const status = analysis.status || 'INESTABLE';
    els.statusText.textContent = status;
    els.statusCard.className = `metric-card status ${statusClass(status)}`;

    els.dxText.textContent = m ? `${m.dxMm.toFixed(1)} mm` : '-- mm';
    els.dyText.textContent = m ? `${m.dyMm.toFixed(1)} mm` : '-- mm';
    els.angleText.textContent = m ? `${m.angleDeg.toFixed(1)}°` : '--°';
    els.scoreText.textContent = m ? `${Math.round(m.score)}%` : '--%';
    els.scoreBar.style.width = m ? `${Math.max(0, Math.min(100, m.score))}%` : '0%';
  }

  function maybeSend(analysis, now) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    if (now - state.lastSend < 100) return;
    state.lastSend = now;

    const payload = minimalPayload(analysis);
    try { state.ws.send(JSON.stringify(payload)); } catch (_) {}
  }

  function minimalPayload(a) {
    return {
      type: 'metrics',
      status: a.status,
      message: a.message,
      metrics: a.metrics || null,
      tolerance: a.tolerance,
      stable: Boolean(a.stable),
      pxPerMm: a.pxPerMm,
      frame: a.frame,
      calibration: stripCalibration(a.calibration),
      patch: stripShape(a.patch),
      text: stripText(a.text),
      client_time: new Date().toISOString(),
    };
  }

  function stripCalibration(c) {
    if (!c) return null;
    return { center: c.center, size: c.size, angle: c.angle, pxPerMm: c.pxPerMm, bbox: c.bbox, rect: c.rect };
  }

  function stripShape(s) {
    if (!s) return null;
    return { center: s.center, size: s.size, angle: s.angle, bbox: s.bbox, area: s.area, rect: s.rect };
  }

  function stripText(t) {
    if (!t) return null;
    return { center: t.center, bbox: t.bbox, angle: t.angle, area: t.area };
  }

  function drawOverlay(a) {
    const color = a.status === 'OK' ? COLORS.ok : a.status === 'MAL' ? COLORS.bad : COLORS.warn;
    drawInspectionGuide();

    if (a.calibration) {
      drawRotatedRect(a.calibration.rect, COLORS.cyan, 3, 'CAL 5×5');
    }
    if (a.patch) {
      drawRotatedRect(a.patch.rect, color, 4, 'PARCHE');
      drawCross(a.patch.center, color, 18);
      drawAxis(a.patch.center, a.patch.angle, 90, color);
    }
    if (a.text) {
      drawBbox(a.text.bbox, '#0b1f33', 3, 'TEXTO');
      drawCross(a.text.center, '#0b1f33', 14);
      drawAxis(a.text.center, a.text.angle, 70, '#0b1f33');
    }
    if (a.patch && a.text) {
      drawDelta(a.patch.center, a.text.center, color);
    }

    drawHud(a, color);
  }

  function drawInspectionGuide() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.save();
    ctx.lineWidth = Math.max(2, w / 450);
    ctx.strokeStyle = 'rgba(15, 143, 136, .70)';
    ctx.setLineDash([12, 8]);
    const gx = w * 0.12;
    const gy = h * 0.12;
    ctx.strokeRect(gx, gy, w - gx * 2, h - gy * 2);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(255,255,255,.90)';
    ctx.lineWidth = Math.max(1, w / 900);
    ctx.beginPath();
    ctx.moveTo(w * .5, gy); ctx.lineTo(w * .5, h - gy);
    ctx.moveTo(gx, h * .5); ctx.lineTo(w - gx, h * .5);
    ctx.stroke();
    ctx.restore();
  }

  function drawHud(a, color) {
    ctx.save();
    ctx.font = `${Math.max(18, canvas.width / 42)}px Inter, sans-serif`;
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.fillStyle = color;
    const text = `${a.status || 'INESTABLE'} · ${a.message || ''}`;
    ctx.strokeText(text, 22, 38);
    ctx.fillText(text, 22, 38);
    ctx.restore();
  }

  function drawRotatedRect(rect, color, lineWidth = 3, label = '') {
    if (!rect) return;
    const pts = rotatedRectPoints(rect);
    ctx.save();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
    if (label) drawLabel(label, pts[0].x, pts[0].y, color);
    ctx.restore();
  }

  function drawBbox(b, color, lineWidth = 3, label = '') {
    ctx.save();
    ctx.lineWidth = lineWidth;
    ctx.strokeStyle = color;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    if (label) drawLabel(label, b.x, b.y, color);
    ctx.restore();
  }

  function drawLabel(label, x, y, color) {
    ctx.save();
    ctx.font = `${Math.max(12, canvas.width / 90)}px Inter, sans-serif`;
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.lineWidth = 4;
    ctx.strokeText(label, x + 4, y - 6);
    ctx.fillText(label, x + 4, y - 6);
    ctx.restore();
  }

  function drawCross(p, color, size) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x - size, p.y); ctx.lineTo(p.x + size, p.y);
    ctx.moveTo(p.x, p.y - size); ctx.lineTo(p.x, p.y + size);
    ctx.stroke();
    ctx.restore();
  }

  function drawAxis(center, angleDeg, len, color) {
    const a = angleDeg * Math.PI / 180;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(center.x - Math.cos(a) * len, center.y - Math.sin(a) * len);
    ctx.lineTo(center.x + Math.cos(a) * len, center.y + Math.sin(a) * len);
    ctx.stroke();
    ctx.restore();
  }

  function drawDelta(a, b, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  function serializeRotatedRect(rect) {
    return {
      center: { x: rect.center.x, y: rect.center.y },
      size: { w: rect.size.width, h: rect.size.height },
      angle: rect.angle,
    };
  }

  function rotatedRectPoints(rect) {
    const cx = rect.center.x;
    const cy = rect.center.y;
    const w = rect.size.w;
    const h = rect.size.h;
    const a = rect.angle * Math.PI / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const base = [
      { x: -w / 2, y: -h / 2 },
      { x:  w / 2, y: -h / 2 },
      { x:  w / 2, y:  h / 2 },
      { x: -w / 2, y:  h / 2 },
    ];
    return base.map(p => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }));
  }

  function rectToBbox(rect) {
    const s = serializeRotatedRect(rect);
    const pts = rotatedRectPoints(s);
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function unionRects(a, b) {
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x + a.w, b.x + b.w);
    const y2 = Math.max(a.y + a.h, b.y + b.h);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function overlapRatio(a, b) {
    if (!a || !b) return 0;
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const minArea = Math.max(1, Math.min(a.w * a.h, b.w * b.h));
    return inter / minArea;
  }

  function normalizeRectAngle(rect) {
    let angle = rect.angle;
    if (rect.size.width < rect.size.height) angle += 90;
    return normalizeAngle(angle);
  }

  function normalizeAngle(angle) {
    let a = angle;
    while (a > 90) a -= 180;
    while (a < -90) a += 180;
    return a;
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpAngle(a, b, t) { return normalizeAngle(a + normalizeAngle(b - a) * t); }
  function statusClass(status) {
    if (status === 'OK') return 'ok';
    if (status === 'MAL') return 'bad';
    return 'warn';
  }

  ['tolX', 'tolY', 'tolAngle', 'minScore'].forEach(id => els[id].addEventListener('input', updateToleranceLabels));
  els.startButton.addEventListener('click', startCamera);
  els.connectButton.addEventListener('click', () => connectCaptureSocket(els.manualCode.value));
  els.manualCode.addEventListener('input', () => { els.manualCode.value = cleanCode(els.manualCode.value); });

  (async function init() {
    updateToleranceLabels();
    const code = await createSession();
    connectCaptureSocket(code);
    setUiStatus({ status: 'INESTABLE', message: 'Pulsa iniciar cámara' });
  })();
})();
