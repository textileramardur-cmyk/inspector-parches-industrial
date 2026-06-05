(() => {
  const $ = (id) => document.getElementById(id);

  const dom = {
    video: $("video"),
    canvas: $("viewCanvas"),
    hint: $("cameraHint"),
    sessionCode: $("sessionCode"),
    btnCamera: $("btnCamera"),
    btnCalibrate: $("btnCalibrate"),
    btnRecalibrate: $("btnRecalibrate"),
    mainState: $("mainState"),
    statusDot: $("statusDot"),
    opencvState: $("opencvState"),
    liveScale: $("liveScale"),
    lockedScale: $("lockedScale"),
    stability: $("stability"),
    cardState: $("cardState"),
    verdict: $("verdict"),
    scoreValue: $("scoreValue"),
    dxValue: $("dxValue"),
    dyValue: $("dyValue"),
    angleValue: $("angleValue"),
    patchSize: $("patchSize"),
    textSize: $("textSize"),
    edgeLeft: $("edgeLeft"),
    edgeRight: $("edgeRight"),
    edgeTop: $("edgeTop"),
    edgeBottom: $("edgeBottom"),
    tolX: $("tolX"),
    tolY: $("tolY"),
    tolAngle: $("tolAngle"),
    scoreMin: $("scoreMin"),
    tolXLabel: $("tolXLabel"),
    tolYLabel: $("tolYLabel"),
    tolAngleLabel: $("tolAngleLabel"),
    scoreMinLabel: $("scoreMinLabel"),
  };

  const ctx = dom.canvas.getContext("2d", { alpha: false });

  const state = {
    cvReady: false,
    cameraRunning: false,
    processing: false,
    session: getOrCreateSessionCode(),
    ws: null,
    wsConnected: false,
    frameId: null,
    lastSentAt: 0,
    liveCard: null,
    scaleSamples: [],
    calibration: null,
    lastPayload: null,
    lastStableMessage: "--",
  };

  dom.sessionCode.textContent = state.session;
  setupControls();
  waitForOpenCv();
  connectWebSocket();

  function getOrCreateSessionCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    let code = "";
    for (let i = 0; i < 3; i++) code += chars[Math.floor(Math.random() * chars.length)];
    code += String(Math.floor(100 + Math.random() * 900));
    return code;
  }

  function setupControls() {
    dom.btnCamera.addEventListener("click", startCamera);
    dom.btnCalibrate.addEventListener("click", lockCalibration);
    dom.btnRecalibrate.addEventListener("click", () => {
      state.calibration = null;
      state.scaleSamples = [];
      dom.lockedScale.textContent = "--";
      setMainState("BUSCANDO TARJETA", "warn");
    });

    [dom.tolX, dom.tolY, dom.tolAngle, dom.scoreMin].forEach((input) => {
      input.addEventListener("input", updateToleranceLabels);
    });
    updateToleranceLabels();
  }

  function updateToleranceLabels() {
    dom.tolXLabel.textContent = `${Number(dom.tolX.value).toFixed(1)} mm`;
    dom.tolYLabel.textContent = `${Number(dom.tolY.value).toFixed(1)} mm`;
    dom.tolAngleLabel.textContent = `${Number(dom.tolAngle.value).toFixed(0)}°`;
    dom.scoreMinLabel.textContent = `${Number(dom.scoreMin.value).toFixed(0)}%`;
  }

  function getTolerances() {
    return {
      xMm: Number(dom.tolX.value),
      yMm: Number(dom.tolY.value),
      angleDeg: Number(dom.tolAngle.value),
      scoreMin: Number(dom.scoreMin.value),
    };
  }

  function waitForOpenCv() {
    const start = Date.now();
    const timer = setInterval(() => {
      if (window.cv && cv.Mat && cv.imread && cv.findContours) {
        clearInterval(timer);
        state.cvReady = true;
        dom.opencvState.textContent = "OpenCV.js listo";
        if (!state.cameraRunning) setMainState("SIN CÁMARA", "unstable");
        return;
      }
      if (Date.now() - start > 25000) {
        clearInterval(timer);
        dom.opencvState.textContent = "OpenCV.js no cargó. Revisa conexión y recarga.";
      }
    }, 250);
  }

  async function startCamera() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setMainState("CÁMARA NO SOPORTADA", "bad");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      dom.video.srcObject = stream;
      await dom.video.play();

      resizeCanvasFromVideo();
      state.cameraRunning = true;
      dom.hint.style.display = "none";
      dom.btnCamera.textContent = "Cámara activa";
      dom.btnCamera.disabled = true;
      setMainState("BUSCANDO TARJETA", "warn");
      loop();
    } catch (err) {
      console.error(err);
      setMainState("ERROR DE CÁMARA", "bad");
      dom.opencvState.textContent = "No se pudo abrir la cámara. Revisa permisos.";
    }
  }

  function resizeCanvasFromVideo() {
    const vw = dom.video.videoWidth || 1280;
    const vh = dom.video.videoHeight || 720;
    const maxW = 960;
    const scale = Math.min(1, maxW / vw);
    dom.canvas.width = Math.round(vw * scale);
    dom.canvas.height = Math.round(vh * scale);
  }

  function loop() {
    if (!state.cameraRunning) return;
    state.frameId = requestAnimationFrame(loop);
    if (!state.cvReady || state.processing) {
      drawCameraFrameOnly();
      return;
    }
    processFrame();
  }

  function drawCameraFrameOnly() {
    if (!dom.video.videoWidth) return;
    ctx.drawImage(dom.video, 0, 0, dom.canvas.width, dom.canvas.height);
    drawGuide(ctx);
  }

  function processFrame() {
    state.processing = true;
    ctx.drawImage(dom.video, 0, 0, dom.canvas.width, dom.canvas.height);
    let src = null;
    let gray = null;

    try {
      src = cv.imread(dom.canvas);
      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      const card = detectCalibrationCard(gray);
      state.liveCard = card;
      updateScaleSamples(card);

      const stable = getScaleStability();
      const pxPerMm = state.calibration ? state.calibration.pxPerMm : (stable.ok ? stable.average : null);
      const inspection = pxPerMm ? detectPatchAndText(gray, pxPerMm, card) : null;
      const payload = buildPayload(card, stable, inspection);

      drawOverlay(payload, card, inspection);
      updateUi(payload);
      maybeSend(payload);
    } catch (err) {
      console.error(err);
    } finally {
      if (gray) gray.delete();
      if (src) src.delete();
      state.processing = false;
    }
  }

  function detectCalibrationCard(gray) {
    const blur = new cv.Mat();
    const bin = new cv.Mat();
    const morph = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    let kernel = null;
    let best = null;

    try {
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
      // Detecta el interior negro de 5×5 cm. Es más confiable que buscar blanco sobre mesa blanca.
      cv.threshold(blur, bin, 80, 255, cv.THRESH_BINARY_INV);
      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
      cv.morphologyEx(bin, morph, cv.MORPH_CLOSE, kernel);
      cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const frameArea = gray.rows * gray.cols;
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area < frameArea * 0.0012 || area > frameArea * 0.35) {
          cnt.delete();
          continue;
        }

        const rect = cv.minAreaRect(cnt);
        const w = Math.max(rect.size.width, 1);
        const h = Math.max(rect.size.height, 1);
        const ratio = Math.max(w, h) / Math.min(w, h);
        const rectArea = w * h;
        const fill = area / Math.max(rectArea, 1);
        const side = (w + h) / 2;

        if (ratio > 1.28 || fill < 0.45 || side < 35) {
          cnt.delete();
          continue;
        }

        const bbox = cv.boundingRect(cnt);
        const centerBias = 1 - Math.min(1, distanceNorm(rect.center.x, rect.center.y, gray.cols / 2, gray.rows / 2, gray.cols, gray.rows));
        const score = area * (0.75 + centerBias * 0.25);

        if (!best || score > best.score) {
          best = {
            score,
            area,
            rect,
            bbox,
            sidePx: side,
            pxPerMm: side / 50.0,
            vertices: rectPoints(rect),
            expectedOuter: expectedOuterFromInner(rect, 1.4),
          };
        }
        cnt.delete();
      }
    } finally {
      blur.delete();
      bin.delete();
      morph.delete();
      contours.delete();
      hierarchy.delete();
      if (kernel) kernel.delete();
    }

    return best;
  }

  function expectedOuterFromInner(rect, factor) {
    return {
      center: { x: rect.center.x, y: rect.center.y },
      size: { width: rect.size.width * factor, height: rect.size.height * factor },
      angle: rect.angle,
    };
  }

  function updateScaleSamples(card) {
    if (!card || !Number.isFinite(card.pxPerMm)) return;
    const sample = { value: card.pxPerMm, x: card.rect.center.x, y: card.rect.center.y, t: performance.now() };
    state.scaleSamples.push(sample);
    if (state.scaleSamples.length > 14) state.scaleSamples.shift();
  }

  function getScaleStability() {
    const samples = state.scaleSamples.slice(-10);
    if (samples.length < 5) return { ok: false, label: "Insuficiente", average: null, cv: null };
    const values = samples.map((s) => s.value);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / values.length;
    const std = Math.sqrt(variance);
    const cvValue = std / Math.max(avg, 0.0001);
    const xs = samples.map((s) => s.x);
    const ys = samples.map((s) => s.y);
    const drift = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const ok = cvValue < 0.045 && drift < 28;
    return {
      ok,
      label: ok ? "Estable" : "Inestable",
      average: avg,
      cv: cvValue,
      drift,
    };
  }

  function lockCalibration() {
    const stable = getScaleStability();
    if (!state.liveCard || !stable.average) return;
    // Permite calibrar aunque esté apenas inestable, pero deja trazabilidad visual.
    state.calibration = {
      pxPerMm: stable.average,
      lockedAt: new Date().toISOString(),
      source: "Tarjeta 7×7 cm / interior negro 5×5 cm",
    };
    dom.lockedScale.textContent = `${stable.average.toFixed(2)} px/mm`;
    setMainState("ESCALA REGISTRADA", "ok");
  }

  function detectPatchAndText(gray, pxPerMm, card) {
    const blur = new cv.Mat();
    const edges = new cv.Mat();
    const dilated = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    let kernel = null;
    let bestContour = null;
    let bestScore = -Infinity;

    try {
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
      cv.Canny(blur, edges, 45, 135, 3, false);
      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
      cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), 1);
      cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const frameArea = gray.rows * gray.cols;
      const cardBox = card ? card.bbox : null;
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area < frameArea * 0.006 || area > frameArea * 0.72) {
          cnt.delete();
          continue;
        }

        const bbox = cv.boundingRect(cnt);
        if (cardBox && overlapRatio(bbox, cardBox) > 0.20) {
          cnt.delete();
          continue;
        }

        const rect = cv.minAreaRect(cnt);
        const w = Math.max(rect.size.width, 1);
        const h = Math.max(rect.size.height, 1);
        const ratio = Math.max(w, h) / Math.min(w, h);
        if (ratio > 4.5 || Math.min(w, h) < 25) {
          cnt.delete();
          continue;
        }

        const centerBias = 1 - Math.min(1, distanceNorm(rect.center.x, rect.center.y, gray.cols / 2, gray.rows / 2, gray.cols, gray.rows));
        const score = area * (0.60 + centerBias * 0.55);
        if (score > bestScore) {
          if (bestContour) bestContour.delete();
          bestContour = cnt.clone();
          bestScore = score;
        }
        cnt.delete();
      }

      if (!bestContour) return null;

      const patchRect = cv.minAreaRect(bestContour);
      const patchInfo = normalizedRectInfo(patchRect);
      const text = detectTextInsidePatch(gray, bestContour, patchRect, pxPerMm);
      const patch = {
        center: patchInfo.center,
        widthPx: patchInfo.width,
        heightPx: patchInfo.height,
        widthMm: patchInfo.width / pxPerMm,
        heightMm: patchInfo.height / pxPerMm,
        angleDeg: patchInfo.angle,
        vertices: rectPoints(patchRect),
        bbox: cv.boundingRect(bestContour),
      };

      if (!text) {
        return { patch, text: null, metrics: null };
      }

      const metrics = computeAlignmentMetrics(patchRect, text.rect, pxPerMm);
      return { patch, text, metrics };
    } finally {
      if (bestContour) bestContour.delete();
      blur.delete();
      edges.delete();
      dilated.delete();
      contours.delete();
      hierarchy.delete();
      if (kernel) kernel.delete();
    }
  }

  function detectTextInsidePatch(gray, patchContour, patchRect, pxPerMm) {
    const bbox = cv.boundingRect(patchContour);
    const pad = Math.round(4 * pxPerMm);
    const x = clamp(Math.floor(bbox.x + pad), 0, gray.cols - 1);
    const y = clamp(Math.floor(bbox.y + pad), 0, gray.rows - 1);
    const right = clamp(Math.ceil(bbox.x + bbox.width - pad), x + 1, gray.cols);
    const bottom = clamp(Math.ceil(bbox.y + bbox.height - pad), y + 1, gray.rows);
    const w = right - x;
    const h = bottom - y;

    if (w < 25 || h < 20) return null;

    const roiRect = new cv.Rect(x, y, w, h);
    const roi = gray.roi(roiRect);
    const bin = new cv.Mat();
    const morph = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    let kernel = null;
    let points = [];
    let union = null;

    try {
      const blockSize = Math.max(15, Math.floor(Math.min(w, h) / 4) | 1);
      const safeBlock = blockSize % 2 === 1 ? blockSize : blockSize + 1;
      cv.adaptiveThreshold(roi, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, safeBlock, 7);
      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 2));
      cv.morphologyEx(bin, morph, cv.MORPH_CLOSE, kernel);
      cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const roiArea = w * h;
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const b = cv.boundingRect(cnt);
        const boxArea = b.width * b.height;
        const area = cv.contourArea(cnt);

        const touchesBorder = b.x < w * 0.025 || b.y < h * 0.025 || (b.x + b.width) > w * 0.975 || (b.y + b.height) > h * 0.975;
        const tooBig = boxArea > roiArea * 0.23 || b.width > w * 0.92 || b.height > h * 0.72;
        const tooSmall = boxArea < roiArea * 0.00025 || b.width < 3 || b.height < 3 || area < 2;

        if (!tooSmall && !tooBig && !touchesBorder) {
          const globalB = { x: x + b.x, y: y + b.y, width: b.width, height: b.height };
          union = union ? unionRect(union, globalB) : globalB;
          const data = cnt.data32S;
          for (let p = 0; p < data.length; p += 2) {
            points.push(data[p] + x, data[p + 1] + y);
          }
        }
        cnt.delete();
      }

      if (points.length < 12 || !union) return null;

      const pointMat = cv.matFromArray(points.length / 2, 1, cv.CV_32SC2, points);
      const textRect = cv.minAreaRect(pointMat);
      pointMat.delete();

      const info = normalizedRectInfo(textRect);
      return {
        rect: textRect,
        center: info.center,
        widthPx: info.width,
        heightPx: info.height,
        widthMm: info.width / pxPerMm,
        heightMm: info.height / pxPerMm,
        angleDeg: info.angle,
        bbox: union,
        vertices: rectPoints(textRect),
      };
    } finally {
      roi.delete();
      bin.delete();
      morph.delete();
      contours.delete();
      hierarchy.delete();
      if (kernel) kernel.delete();
    }
  }

  function computeAlignmentMetrics(patchRect, textRect, pxPerMm) {
    const patch = normalizedRectInfo(patchRect);
    const text = normalizedRectInfo(textRect);
    const theta = degToRad(patch.angle);
    const ux = { x: Math.cos(theta), y: Math.sin(theta) };
    const uy = { x: -Math.sin(theta), y: Math.cos(theta) };

    const rel = { x: text.center.x - patch.center.x, y: text.center.y - patch.center.y };
    const offsetXPx = rel.x * ux.x + rel.y * ux.y;
    const offsetYPx = rel.x * uy.x + rel.y * uy.y;

    const textVertices = rectPoints(textRect);
    const projected = textVertices.map((p) => {
      const d = { x: p.x - patch.center.x, y: p.y - patch.center.y };
      return {
        x: d.x * ux.x + d.y * ux.y,
        y: d.x * uy.x + d.y * uy.y,
      };
    });

    const xs = projected.map((p) => p.x);
    const ys = projected.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const halfW = patch.width / 2;
    const halfH = patch.height / 2;
    const left = (minX + halfW) / pxPerMm;
    const right = (halfW - maxX) / pxPerMm;
    const top = (minY + halfH) / pxPerMm;
    const bottom = (halfH - maxY) / pxPerMm;

    return {
      offsetXmm: offsetXPx / pxPerMm,
      offsetYmm: offsetYPx / pxPerMm,
      angleDeg: normalizeAngle(text.angle - patch.angle),
      edges: { left, right, top, bottom },
    };
  }

  function buildPayload(card, stable, inspection) {
    const tolerances = getTolerances();
    const calibration = {
      locked: Boolean(state.calibration),
      pxPerMm: state.calibration ? state.calibration.pxPerMm : null,
      livePxPerMm: card ? card.pxPerMm : null,
      stable: stable.ok,
      stabilityLabel: stable.label,
      cardDetected: Boolean(card),
    };

    let verdict = "INESTABLE";
    let score = null;
    let reason = "Calibra la tarjeta 7×7 para iniciar inspección.";

    if (!state.calibration) {
      if (card && stable.ok) reason = "Patrón estable. Presiona Calibrar 7×7.";
      else if (card) reason = "Patrón detectado, espera estabilidad.";
    } else if (!inspection || !inspection.patch) {
      reason = "Escala registrada. Buscando contorno del parche.";
    } else if (!inspection.text || !inspection.metrics) {
      reason = "Parche detectado. Buscando texto interior.";
    } else {
      score = calculateScore(inspection.metrics, tolerances);
      verdict = score >= tolerances.scoreMin ? "OK" : "MAL";
      reason = verdict === "OK" ? "Dentro de tolerancia." : "Fuera de tolerancia.";
    }

    return {
      type: "inspection",
      version: "2.0.0",
      session: state.session,
      timestamp: new Date().toISOString(),
      state: state.calibration ? "INSPECCIONANDO" : (card ? "BUSCANDO ESTABILIDAD" : "BUSCANDO TARJETA"),
      verdict,
      score,
      reason,
      calibration,
      tolerances,
      measurements: inspection ? {
        patch: inspection.patch || null,
        text: inspection.text ? {
          center: inspection.text.center,
          widthMm: inspection.text.widthMm,
          heightMm: inspection.text.heightMm,
          angleDeg: inspection.text.angleDeg,
          vertices: inspection.text.vertices,
          bbox: inspection.text.bbox,
        } : null,
        alignment: inspection.metrics || null,
      } : null,
    };
  }

  function calculateScore(metrics, tolerances) {
    const sx = clamp01(1 - Math.abs(metrics.offsetXmm) / Math.max(tolerances.xMm, 0.001));
    const sy = clamp01(1 - Math.abs(metrics.offsetYmm) / Math.max(tolerances.yMm, 0.001));
    const sa = clamp01(1 - Math.abs(metrics.angleDeg) / Math.max(tolerances.angleDeg, 0.001));
    return Math.round((sx * 0.40 + sy * 0.40 + sa * 0.20) * 100);
  }

  function drawOverlay(payload, card, inspection) {
    drawGuide(ctx);

    if (card) {
      drawPoly(ctx, card.expectedOuter ? rectPoints(card.expectedOuter) : [], "#0f766e", 2);
      drawPoly(ctx, card.vertices, "#0b5fff", 3);
      drawLabel(ctx, card.rect.center.x + 8, card.rect.center.y - 8, "5×5 cm detectado");
    }

    if (inspection && inspection.patch) {
      drawPoly(ctx, inspection.patch.vertices, payload.verdict === "OK" ? "#12805c" : "#c53030", 4);
      drawCross(ctx, inspection.patch.center.x, inspection.patch.center.y, "#0b5fff", 18);
      drawLabel(ctx, inspection.patch.center.x + 10, inspection.patch.center.y + 16, "Centro parche");
    }

    if (inspection && inspection.text) {
      drawPoly(ctx, inspection.text.vertices, "#b7791f", 3);
      drawCross(ctx, inspection.text.center.x, inspection.text.center.y, "#b7791f", 14);
      drawLabel(ctx, inspection.text.center.x + 10, inspection.text.center.y - 14, "Centro texto");

      if (inspection.patch) {
        ctx.save();
        ctx.strokeStyle = "#34495e";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(inspection.patch.center.x, inspection.patch.center.y);
        ctx.lineTo(inspection.text.center.x, inspection.text.center.y);
        ctx.stroke();
        ctx.restore();
      }
    }

    drawTopBanner(ctx, payload);
  }

  function drawGuide(ctx) {
    const w = dom.canvas.width;
    const h = dom.canvas.height;
    if (!w || !h) return;
    const size = Math.min(w, h) * 0.58;
    const x = (w - size) / 2;
    const y = (h - size) / 2;

    ctx.save();
    ctx.strokeStyle = "rgba(15, 118, 110, 0.62)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(x, y, size, size);
    ctx.fillStyle = "rgba(255,255,255,0.76)";
    ctx.fillRect(x + 10, y + 10, 245, 30);
    ctx.fillStyle = "#0f766e";
    ctx.font = "700 15px system-ui";
    ctx.fillText("Guía: tarjeta 7×7 / parche", x + 22, y + 31);
    ctx.restore();
  }

  function drawTopBanner(ctx, payload) {
    const text = `${payload.verdict} · ${payload.reason}`;
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
    ctx.fillRect(12, 12, Math.min(dom.canvas.width - 24, 650), 42);
    ctx.strokeStyle = "rgba(16,32,51,0.16)";
    ctx.strokeRect(12, 12, Math.min(dom.canvas.width - 24, 650), 42);
    ctx.fillStyle = payload.verdict === "OK" ? "#12805c" : payload.verdict === "MAL" ? "#c53030" : "#536171";
    ctx.font = "800 18px system-ui";
    ctx.fillText(text.substring(0, 80), 24, 39);
    ctx.restore();
  }

  function updateUi(payload) {
    state.lastPayload = payload;
    const c = payload.calibration;
    dom.liveScale.textContent = c.livePxPerMm ? `${c.livePxPerMm.toFixed(2)} px/mm` : "--";
    dom.lockedScale.textContent = c.pxPerMm ? `${c.pxPerMm.toFixed(2)} px/mm` : "--";
    dom.stability.textContent = c.stabilityLabel || "--";
    dom.cardState.textContent = c.cardDetected ? "Detectado" : "No detectado";
    dom.btnCalibrate.disabled = !state.liveCard;

    setMainState(payload.state, payload.verdict === "OK" ? "ok" : payload.verdict === "MAL" ? "bad" : "warn");
    setVerdict(payload.verdict, payload.score);

    const m = payload.measurements;
    if (!m || !m.alignment) {
      dom.dxValue.textContent = "--";
      dom.dyValue.textContent = "--";
      dom.angleValue.textContent = "--";
      dom.edgeLeft.textContent = "--";
      dom.edgeRight.textContent = "--";
      dom.edgeTop.textContent = "--";
      dom.edgeBottom.textContent = "--";
    } else {
      dom.dxValue.textContent = fmtMmSigned(m.alignment.offsetXmm);
      dom.dyValue.textContent = fmtMmSigned(m.alignment.offsetYmm);
      dom.angleValue.textContent = `${m.alignment.angleDeg.toFixed(1)}°`;
      dom.edgeLeft.textContent = fmtMm(m.alignment.edges.left);
      dom.edgeRight.textContent = fmtMm(m.alignment.edges.right);
      dom.edgeTop.textContent = fmtMm(m.alignment.edges.top);
      dom.edgeBottom.textContent = fmtMm(m.alignment.edges.bottom);
    }

    if (m && m.patch) dom.patchSize.textContent = `${m.patch.widthMm.toFixed(1)} × ${m.patch.heightMm.toFixed(1)} mm`;
    else dom.patchSize.textContent = "--";

    if (m && m.text) dom.textSize.textContent = `${m.text.widthMm.toFixed(1)} × ${m.text.heightMm.toFixed(1)} mm`;
    else dom.textSize.textContent = "--";
  }

  function setVerdict(verdict, score) {
    dom.verdict.textContent = verdict;
    dom.verdict.className = "verdict " + verdictClass(verdict);
    dom.scoreValue.textContent = Number.isFinite(score) ? `${score}%` : "--%";
  }

  function setMainState(text, mode) {
    dom.mainState.textContent = text;
    dom.statusDot.className = `status-dot ${mode || "unstable"}`;
  }

  function maybeSend(payload) {
    const now = Date.now();
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    if (now - state.lastSentAt < 180) return;
    state.ws.send(JSON.stringify(payload));
    state.lastSentAt = now;
  }

  function connectWebSocket() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws/${state.session}/capture`;
    try {
      state.ws = new WebSocket(url);
      state.ws.onopen = () => { state.wsConnected = true; };
      state.ws.onclose = () => {
        state.wsConnected = false;
        setTimeout(connectWebSocket, 1500);
      };
      state.ws.onerror = () => { state.wsConnected = false; };
    } catch (err) {
      console.error(err);
      setTimeout(connectWebSocket, 2500);
    }
  }

  function rectPoints(rect) {
    if (!rect) return [];
    const pts = cv.RotatedRect.points(rect);
    return pts.map((p) => ({ x: p.x, y: p.y }));
  }

  function normalizedRectInfo(rect) {
    let width = Math.max(rect.size.width, 1);
    let height = Math.max(rect.size.height, 1);
    let angle = rect.angle;
    if (width < height) {
      const tmp = width;
      width = height;
      height = tmp;
      angle += 90;
    }
    return {
      center: { x: rect.center.x, y: rect.center.y },
      width,
      height,
      angle: normalizeAngle(angle),
    };
  }

  function drawPoly(ctx, points, color, lineWidth) {
    if (!points || points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth || 2;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawCross(ctx, x, y, color, size) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();
    ctx.restore();
  }

  function drawLabel(ctx, x, y, text) {
    ctx.save();
    ctx.font = "700 13px system-ui";
    const width = ctx.measureText(text).width + 14;
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillRect(x, y - 17, width, 22);
    ctx.fillStyle = "#102033";
    ctx.fillText(text, x + 7, y - 2);
    ctx.restore();
  }

  function overlapRatio(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    const iw = Math.max(0, x2 - x1);
    const ih = Math.max(0, y2 - y1);
    const inter = iw * ih;
    const minArea = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
    return inter / minArea;
  }

  function unionRect(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const right = Math.max(a.x + a.width, b.x + b.width);
    const bottom = Math.max(a.y + a.height, b.y + b.height);
    return { x, y, width: right - x, height: bottom - y };
  }

  function distanceNorm(x1, y1, x2, y2, w, h) {
    const d = Math.hypot(x1 - x2, y1 - y2);
    return d / Math.hypot(w, h);
  }

  function normalizeAngle(angle) {
    let a = angle;
    while (a > 90) a -= 180;
    while (a < -90) a += 180;
    if (a > 45) a -= 90;
    if (a < -45) a += 90;
    return a;
  }

  function degToRad(deg) { return deg * Math.PI / 180; }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function clamp01(v) { return clamp(v, 0, 1); }
  function fmtMm(v) { return Number.isFinite(v) ? `${v.toFixed(1)} mm` : "--"; }
  function fmtMmSigned(v) { return Number.isFinite(v) ? `${v >= 0 ? "+" : ""}${v.toFixed(1)} mm` : "--"; }
  function verdictClass(v) { return v === "OK" ? "ok" : v === "MAL" ? "bad" : "unstable"; }
})();
