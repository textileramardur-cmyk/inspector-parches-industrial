(() => {
  const $ = (id) => document.getElementById(id);

  const dom = {
    video: $("video"),
    canvas: $("viewCanvas"),
    hint: $("cameraHint"),
    sessionCode: $("sessionCode"),
    btnCamera: $("btnCamera"),
    btnCalibrate: $("btnCalibrate"),
    btnNewPatch: $("btnNewPatch"),
    btnRecalibrate: $("btnRecalibrate"),
    mainState: $("mainState"),
    statusDot: $("statusDot"),
    opencvState: $("opencvState"),
    operatorInstruction: $("operatorInstruction"),
    nextAction: $("nextAction"),
    stepCamera: $("stepCamera"),
    stepCard: $("stepCard"),
    stepPatch: $("stepPatch"),
    friendlyCard: $("friendlyCard"),
    friendlyScale: $("friendlyScale"),
    friendlyText: $("friendlyText"),
    liveScale: $("liveScale"),
    lockedScale: $("lockedScale"),
    stability: $("stability"),
    cardState: $("cardState"),
    verdict: $("verdict"),
    scoreValue: $("scoreValue"),
    reasonText: $("reasonText"),
    dxValue: $("dxValue"),
    dyValue: $("dyValue"),
    angleValue: $("angleValue"),
    patchSize: $("patchSize"),
    textSize: $("textSize"),
    edgeLeft: $("edgeLeft"),
    edgeRight: $("edgeRight"),
    edgeTop: $("edgeTop"),
    edgeBottom: $("edgeBottom"),
    precisionPreset: $("precisionPreset"),
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
    flow: "camera", // camera | card | patch
    session: getOrCreateSessionCode(),
    ws: null,
    wsConnected: false,
    frameId: null,
    lastSentAt: 0,
    liveCard: null,
    scaleSamples: [],
    calibration: null,
    lastPayload: null,
  };

  dom.sessionCode.textContent = state.session;
  setupControls();
  updateFlowUi();
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
    dom.btnNewPatch.addEventListener("click", () => {
      if (state.calibration) {
        state.flow = "patch";
        updateFlowUi("Coloca otro parche dentro de la guía. Mantén el celular quieto.");
      }
    });
    dom.btnRecalibrate.addEventListener("click", () => {
      state.calibration = null;
      state.scaleSamples = [];
      state.flow = state.cameraRunning ? "card" : "camera";
      dom.lockedScale.textContent = "--";
      setMainState(state.cameraRunning ? "COLOCA TARJETA" : "SIN CÁMARA", state.cameraRunning ? "warn" : "unstable");
      updateFlowUi();
    });

    dom.precisionPreset.addEventListener("change", applyPreset);
    [dom.tolX, dom.tolY, dom.tolAngle, dom.scoreMin].forEach((input) => {
      input.addEventListener("input", updateToleranceLabels);
    });
    applyPreset();
  }

  function applyPreset() {
    const preset = dom.precisionPreset.value;
    const values = {
      strict: { x: 2, y: 2, a: 3, s: 90 },
      normal: { x: 3, y: 3, a: 5, s: 85 },
      loose: { x: 5, y: 5, a: 7, s: 75 },
    }[preset] || { x: 3, y: 3, a: 5, s: 85 };
    dom.tolX.value = values.x;
    dom.tolY.value = values.y;
    dom.tolAngle.value = values.a;
    dom.scoreMin.value = values.s;
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
      label: dom.precisionPreset.options[dom.precisionPreset.selectedIndex]?.textContent || "Normal",
    };
  }

  function updateFlowUi(customMessage) {
    const active = state.flow;
    setStep(dom.stepCamera, active === "camera", state.cameraRunning || state.calibration);
    setStep(dom.stepCard, active === "card", Boolean(state.calibration));
    setStep(dom.stepPatch, active === "patch", false);

    let instruction = "Toca “Iniciar cámara”. Después la app te pedirá la tarjeta 7×7.";
    let action = "Inicia la cámara del celular.";

    if (active === "card") {
      instruction = "Coloca la tarjeta 7×7 dentro de la guía. Cuando se detecte estable, toca “Ya puse la tarjeta · Calibrar”.";
      action = "Coloca la tarjeta 7×7 cm, con el cuadro negro 5×5 visible y centrado.";
    } else if (active === "patch") {
      instruction = "Retira la tarjeta y coloca el parche. La app medirá el parche y el texto automáticamente.";
      action = "Coloca el parche dentro de la guía. Mantén el celular quieto.";
    }

    dom.operatorInstruction.textContent = customMessage || instruction;
    dom.nextAction.textContent = customMessage || action;
  }

  function setStep(el, active, done) {
    el.classList.toggle("active", active);
    el.classList.toggle("done", done && !active);
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
      state.flow = "card";
      dom.hint.style.display = "none";
      dom.btnCamera.textContent = "Cámara activa";
      dom.btnCamera.disabled = true;
      setMainState("COLOCA TARJETA", "warn");
      updateFlowUi();
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
    const maxW = 980;
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

      const card = state.flow !== "patch" ? detectCalibrationCard(gray) : null;
      state.liveCard = card;
      if (state.flow === "card") updateScaleSamples(card);

      const stable = getScaleStability();
      const pxPerMm = state.calibration ? state.calibration.pxPerMm : null;
      const inspection = (state.flow === "patch" && pxPerMm) ? detectPatchAndText(gray, pxPerMm, null) : null;
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
      cv.threshold(blur, bin, 85, 255, cv.THRESH_BINARY_INV);
      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
      cv.morphologyEx(bin, morph, cv.MORPH_CLOSE, kernel);
      cv.findContours(morph, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const frameArea = gray.rows * gray.cols;
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area < frameArea * 0.0012 || area > frameArea * 0.35) { cnt.delete(); continue; }

        const rect = cv.minAreaRect(cnt);
        const w = Math.max(rect.size.width, 1);
        const h = Math.max(rect.size.height, 1);
        const ratio = Math.max(w, h) / Math.min(w, h);
        const rectArea = w * h;
        const fill = area / Math.max(rectArea, 1);
        const side = (w + h) / 2;

        if (ratio > 1.24 || fill < 0.45 || side < 35) { cnt.delete(); continue; }

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
      blur.delete(); bin.delete(); morph.delete(); contours.delete(); hierarchy.delete(); if (kernel) kernel.delete();
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
    if (state.scaleSamples.length > 16) state.scaleSamples.shift();
  }

  function getScaleStability() {
    const samples = state.scaleSamples.slice(-10);
    if (samples.length < 5) return { ok: false, label: "Esperando", average: null, cv: null };
    const values = samples.map((s) => s.value);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / values.length;
    const std = Math.sqrt(variance);
    const cvValue = std / Math.max(avg, 0.0001);
    const xs = samples.map((s) => s.x);
    const ys = samples.map((s) => s.y);
    const drift = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const ok = cvValue < 0.05 && drift < 34;
    return { ok, label: ok ? "Lista" : "Movida", average: avg, cv: cvValue, drift };
  }

  function lockCalibration() {
    const stable = getScaleStability();
    if (!state.liveCard || !stable.average) return;
    state.calibration = {
      pxPerMm: stable.average,
      lockedAt: new Date().toISOString(),
      source: "Tarjeta 7×7 cm / interior negro 5×5 cm",
    };
    state.flow = "patch";
    dom.lockedScale.textContent = `${stable.average.toFixed(2)} px/mm`;
    setMainState("COLOCA PARCHE", "ok");
    updateFlowUi("Calibración guardada. Ahora retira la tarjeta y coloca el parche dentro de la guía.");
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
      cv.Canny(blur, edges, 35, 120, 3, false);
      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
      cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), 1);
      cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const frameArea = gray.rows * gray.cols;
      const cardBox = card ? card.bbox : null;
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area < frameArea * 0.0045 || area > frameArea * 0.72) { cnt.delete(); continue; }

        const bbox = cv.boundingRect(cnt);
        if (cardBox && overlapRatio(bbox, cardBox) > 0.20) { cnt.delete(); continue; }

        const rect = cv.minAreaRect(cnt);
        const w = Math.max(rect.size.width, 1);
        const h = Math.max(rect.size.height, 1);
        const ratio = Math.max(w, h) / Math.min(w, h);
        if (ratio > 4.8 || Math.min(w, h) < 25) { cnt.delete(); continue; }

        const centerBias = 1 - Math.min(1, distanceNorm(rect.center.x, rect.center.y, gray.cols / 2, gray.rows / 2, gray.cols, gray.rows));
        const score = area * (0.55 + centerBias * 0.65);
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

      if (!text) return { patch, text: null, metrics: null };
      const metrics = computeAlignmentMetrics(patchRect, text.rect, pxPerMm);
      return { patch, text, metrics };
    } finally {
      if (bestContour) bestContour.delete();
      blur.delete(); edges.delete(); dilated.delete(); contours.delete(); hierarchy.delete(); if (kernel) kernel.delete();
    }
  }

  function detectTextInsidePatch(gray, patchContour, patchRect, pxPerMm) {
    const bbox = cv.boundingRect(patchContour);
    const pad = Math.max(8, Math.round(3.0 * pxPerMm));
    const x = clamp(Math.floor(bbox.x + pad), 0, gray.cols - 1);
    const y = clamp(Math.floor(bbox.y + pad), 0, gray.rows - 1);
    const right = clamp(Math.ceil(bbox.x + bbox.width - pad), x + 1, gray.cols);
    const bottom = clamp(Math.ceil(bbox.y + bbox.height - pad), y + 1, gray.rows);
    const w = right - x;
    const h = bottom - y;
    if (w < 25 || h < 20) return null;

    const roiRect = new cv.Rect(x, y, w, h);
    const roi = gray.roi(roiRect);
    const blur = new cv.Mat();
    cv.GaussianBlur(roi, blur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);

    const masks = [];
    try {
      masks.push(makeAdaptiveMask(blur, true));
      masks.push(makeAdaptiveMask(blur, false));
      masks.push(makeOtsuMask(blur, true));
      masks.push(makeOtsuMask(blur, false));
      masks.push(makeEdgeTextMask(blur));

      let best = null;
      for (const item of masks) {
        const candidate = collectTextCandidateFromMask(item.mask, x, y, w, h, pxPerMm, item.name);
        if (candidate && (!best || candidate.score > best.score)) {
          best = candidate;
        }
      }

      if (!best || !best.points || best.points.length < 12 || !best.union) return null;

      const pointMat = cv.matFromArray(best.points.length / 2, 1, cv.CV_32SC2, best.points);
      const textRect = cv.minAreaRect(pointMat);
      pointMat.delete();
      const info = normalizedRectInfo(textRect);

      // Filtro final: evita confundir todo el parche con texto.
      if (info.width > w * 0.94 || info.height > h * 0.78) return null;

      return {
        rect: textRect,
        center: info.center,
        widthPx: info.width,
        heightPx: info.height,
        widthMm: info.width / pxPerMm,
        heightMm: info.height / pxPerMm,
        angleDeg: info.angle,
        bbox: best.union,
        vertices: rectPoints(textRect),
        confidence: best.confidence,
        method: best.method,
      };
    } finally {
      for (const item of masks) item.mask.delete();
      blur.delete();
      roi.delete();
    }
  }

  function makeAdaptiveMask(src, inverse) {
    const mask = new cv.Mat();
    const minSide = Math.min(src.cols, src.rows);
    let block = Math.max(15, Math.floor(minSide / 3));
    if (block % 2 === 0) block += 1;
    block = Math.min(block, 61);
    cv.adaptiveThreshold(src, mask, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, inverse ? cv.THRESH_BINARY_INV : cv.THRESH_BINARY, block, 7);
    postProcessTextMask(mask);
    return { name: inverse ? "adaptativo oscuro" : "adaptativo claro", mask };
  }

  function makeOtsuMask(src, inverse) {
    const mask = new cv.Mat();
    cv.threshold(src, mask, 0, 255, (inverse ? cv.THRESH_BINARY_INV : cv.THRESH_BINARY) + cv.THRESH_OTSU);
    postProcessTextMask(mask);
    return { name: inverse ? "otsu oscuro" : "otsu claro", mask };
  }

  function makeEdgeTextMask(src) {
    const edges = new cv.Mat();
    const mask = new cv.Mat();
    cv.Canny(src, edges, 35, 110, 3, false);
    edges.copyTo(mask);
    edges.delete();
    postProcessTextMask(mask, true);
    return { name: "bordes", mask };
  }

  function postProcessTextMask(mask, edgeMode) {
    const k1 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(edgeMode ? 4 : 3, 2));
    const k2 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(edgeMode ? 9 : 7, 3));
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, k1);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k2);
    k1.delete(); k2.delete();
  }

  function collectTextCandidateFromMask(mask, originX, originY, roiW, roiH, pxPerMm, method) {
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    let union = null;
    let points = [];
    let kept = 0;
    let inkArea = 0;

    try {
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const roiArea = roiW * roiH;
      const minArea = Math.max(8, roiArea * 0.00012);
      const maxArea = roiArea * 0.22;
      const minH = Math.max(3, 0.45 * pxPerMm);
      const maxH = roiH * 0.58;

      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const b = cv.boundingRect(cnt);
        const boxArea = b.width * b.height;
        const area = Math.max(cv.contourArea(cnt), boxArea * 0.18);
        const touchesBorder = b.x < roiW * 0.015 || b.y < roiH * 0.015 || (b.x + b.width) > roiW * 0.985 || (b.y + b.height) > roiH * 0.985;
        const tooBig = boxArea > maxArea || b.width > roiW * 0.92 || b.height > maxH;
        const tooSmall = boxArea < minArea || b.width < 2 || b.height < minH;
        const tooSkinnyTall = b.height > b.width * 8;
        if (!tooSmall && !tooBig && !touchesBorder && !tooSkinnyTall) {
          const globalB = { x: originX + b.x, y: originY + b.y, width: b.width, height: b.height };
          union = union ? unionRect(union, globalB) : globalB;
          inkArea += area;
          kept++;
          const data = cnt.data32S;
          for (let p = 0; p < data.length; p += 2) {
            points.push(data[p] + originX, data[p + 1] + originY);
          }
        }
        cnt.delete();
      }

      if (!union || kept < 1 || points.length < 12) return null;
      const unionArea = union.width * union.height;
      const unionLocalCx = (union.x - originX) + union.width / 2;
      const unionLocalCy = (union.y - originY) + union.height / 2;
      const centerPenalty = distanceNorm(unionLocalCx, unionLocalCy, roiW / 2, roiH / 2, roiW, roiH);
      const fill = inkArea / Math.max(unionArea, 1);
      const saneSize = union.width > roiW * 0.04 && union.height > roiH * 0.025 && unionArea < roiArea * 0.42;
      if (!saneSize || fill < 0.015) return null;

      const score = (unionArea * 0.08) + (kept * 100) + (fill * 900) + ((1 - centerPenalty) * 180);
      const confidence = clamp01((kept / 8) * 0.35 + Math.min(1, fill * 6) * 0.35 + (1 - centerPenalty) * 0.30);
      return { union, points, kept, inkArea, score, confidence, method };
    } finally {
      contours.delete(); hierarchy.delete();
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
      return { x: d.x * ux.x + d.y * ux.y, y: d.x * uy.x + d.y * uy.y };
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
      plain: {
        horizontal: plainHorizontal(offsetXPx / pxPerMm),
        vertical: plainVertical(offsetYPx / pxPerMm),
      },
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

    let verdict = "ESPERA";
    let score = null;
    let reason = "Inicia la cámara para comenzar.";
    let stateLabel = "SIN CÁMARA";

    if (state.flow === "card") {
      stateLabel = "COLOCA TARJETA";
      if (card && stable.ok) {
        reason = "Tarjeta lista. Toca el botón verde para calibrar.";
      } else if (card) {
        reason = "Tarjeta detectada. Mantén el celular quieto unos segundos.";
      } else {
        reason = "Coloca la tarjeta 7×7 dentro de la guía.";
      }
    } else if (state.flow === "patch") {
      stateLabel = "COLOCA PARCHE";
      verdict = "INESTABLE";
      if (!inspection || !inspection.patch) {
        reason = "Buscando el borde del parche. Acerca la prenda y mejora la luz.";
      } else if (!inspection.text || !inspection.metrics) {
        reason = "Parche detectado, pero no localizo el texto. Mejora contraste, luz o acercamiento.";
      } else {
        score = calculateScore(inspection.metrics, tolerances);
        verdict = score >= tolerances.scoreMin ? "OK" : "MAL";
        reason = verdict === "OK" ? "Aprobado. Texto centrado dentro de tolerancia." : "Revisar. El texto está fuera de tolerancia.";
      }
    }

    return {
      type: "inspection",
      version: "3.0.0",
      session: state.session,
      timestamp: new Date().toISOString(),
      flow: state.flow,
      state: stateLabel,
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
          confidence: inspection.text.confidence,
          method: inspection.text.method,
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
      drawLabel(ctx, card.rect.center.x + 8, card.rect.center.y - 8, "Tarjeta 5×5 detectada");
    }

    if (inspection && inspection.patch) {
      drawPoly(ctx, inspection.patch.vertices, payload.verdict === "OK" ? "#12805c" : payload.verdict === "MAL" ? "#c53030" : "#718096", 4);
      drawCross(ctx, inspection.patch.center.x, inspection.patch.center.y, "#0b5fff", 18);
      drawLabel(ctx, inspection.patch.center.x + 10, inspection.patch.center.y + 16, "Centro parche");
    }

    if (inspection && inspection.text) {
      drawPoly(ctx, inspection.text.vertices, "#b7791f", 3);
      drawCross(ctx, inspection.text.center.x, inspection.text.center.y, "#b7791f", 14);
      drawLabel(ctx, inspection.text.center.x + 10, inspection.text.center.y - 14, "Texto");

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
    ctx.strokeStyle = state.flow === "patch" ? "rgba(11,95,255,0.65)" : "rgba(15, 118, 110, 0.65)";
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(x, y, size, size);
    ctx.fillStyle = "rgba(255,255,255,0.80)";
    ctx.fillRect(x + 10, y + 10, 315, 30);
    ctx.fillStyle = state.flow === "patch" ? "#0b5fff" : "#0f766e";
    ctx.font = "800 15px system-ui";
    ctx.fillText(state.flow === "patch" ? "Guía: coloca aquí el parche" : "Guía: tarjeta 7×7 cm", x + 22, y + 31);
    ctx.restore();
  }

  function drawTopBanner(ctx, payload) {
    const text = `${payload.verdict} · ${payload.reason}`;
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.90)";
    ctx.fillRect(12, 12, Math.min(dom.canvas.width - 24, 780), 44);
    ctx.strokeStyle = "rgba(16,32,51,0.16)";
    ctx.strokeRect(12, 12, Math.min(dom.canvas.width - 24, 780), 44);
    ctx.fillStyle = payload.verdict === "OK" ? "#12805c" : payload.verdict === "MAL" ? "#c53030" : "#536171";
    ctx.font = "850 18px system-ui";
    ctx.fillText(text.substring(0, 92), 24, 40);
    ctx.restore();
  }

  function updateUi(payload) {
    state.lastPayload = payload;
    const c = payload.calibration;
    dom.liveScale.textContent = c.livePxPerMm ? `${c.livePxPerMm.toFixed(2)} px/mm` : "--";
    dom.lockedScale.textContent = c.pxPerMm ? `${c.pxPerMm.toFixed(2)} px/mm` : "--";
    dom.stability.textContent = c.stabilityLabel || "--";
    dom.cardState.textContent = c.cardDetected ? "Detectada" : "No detectada";
    dom.friendlyCard.textContent = c.cardDetected ? (c.stable ? "Lista" : "Detectada, no mover") : "No detectada";
    dom.friendlyScale.textContent = c.locked ? "Calibrada" : "Sin calibrar";
    dom.btnCalibrate.disabled = !(state.flow === "card" && state.liveCard && getScaleStability().average);

    setMainState(payload.state, payload.verdict === "OK" ? "ok" : payload.verdict === "MAL" ? "bad" : "warn");
    setVerdict(payload.verdict, payload.score);
    dom.reasonText.textContent = payload.reason;

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
      dom.dxValue.textContent = friendlyOffsetX(m.alignment.offsetXmm);
      dom.dyValue.textContent = friendlyOffsetY(m.alignment.offsetYmm);
      dom.angleValue.textContent = `${m.alignment.angleDeg.toFixed(1)}°`;
      dom.edgeLeft.textContent = fmtMm(m.alignment.edges.left);
      dom.edgeRight.textContent = fmtMm(m.alignment.edges.right);
      dom.edgeTop.textContent = fmtMm(m.alignment.edges.top);
      dom.edgeBottom.textContent = fmtMm(m.alignment.edges.bottom);
    }

    if (m && m.patch) dom.patchSize.textContent = `${m.patch.widthMm.toFixed(1)} × ${m.patch.heightMm.toFixed(1)} mm`;
    else dom.patchSize.textContent = "--";

    if (m && m.text) {
      dom.textSize.textContent = `${m.text.widthMm.toFixed(1)} × ${m.text.heightMm.toFixed(1)} mm`;
      dom.friendlyText.textContent = `Detectado (${Math.round((m.text.confidence || 0) * 100)}%)`;
    } else {
      dom.textSize.textContent = "--";
      dom.friendlyText.textContent = state.flow === "patch" && m && m.patch ? "No detectado" : "Pendiente";
    }
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
      const tmp = width; width = height; height = tmp; angle += 90;
    }
    return { center: { x: rect.center.x, y: rect.center.y }, width, height, angle: normalizeAngle(angle) };
  }

  function drawPoly(ctx, points, color, lineWidth) {
    if (!points || points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth || 2;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath(); ctx.stroke(); ctx.restore();
  }

  function drawCross(ctx, x, y, color, size) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(x - size, y); ctx.lineTo(x + size, y); ctx.moveTo(x, y - size); ctx.lineTo(x, y + size);
    ctx.stroke(); ctx.restore();
  }

  function drawLabel(ctx, x, y, text) {
    ctx.save(); ctx.font = "800 13px system-ui";
    const width = ctx.measureText(text).width + 14;
    ctx.fillStyle = "rgba(255,255,255,0.90)"; ctx.fillRect(x, y - 17, width, 22);
    ctx.fillStyle = "#102033"; ctx.fillText(text, x + 7, y - 2); ctx.restore();
  }

  function overlapRatio(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
    const iw = Math.max(0, x2 - x1), ih = Math.max(0, y2 - y1);
    const inter = iw * ih;
    const minArea = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
    return inter / minArea;
  }

  function unionRect(a, b) {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const right = Math.max(a.x + a.width, b.x + b.width), bottom = Math.max(a.y + a.height, b.y + b.height);
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

  function plainHorizontal(mm) {
    if (!Number.isFinite(mm) || Math.abs(mm) < 0.15) return "centrado";
    return mm > 0 ? "a la derecha" : "a la izquierda";
  }
  function plainVertical(mm) {
    if (!Number.isFinite(mm) || Math.abs(mm) < 0.15) return "centrado";
    return mm > 0 ? "abajo" : "arriba";
  }
  function friendlyOffsetX(mm) {
    if (!Number.isFinite(mm)) return "--";
    if (Math.abs(mm) < 0.15) return "Centrado";
    return `${Math.abs(mm).toFixed(1)} mm ${mm > 0 ? "derecha" : "izquierda"}`;
  }
  function friendlyOffsetY(mm) {
    if (!Number.isFinite(mm)) return "--";
    if (Math.abs(mm) < 0.15) return "Centrado";
    return `${Math.abs(mm).toFixed(1)} mm ${mm > 0 ? "abajo" : "arriba"}`;
  }

  function degToRad(deg) { return deg * Math.PI / 180; }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function clamp01(v) { return clamp(v, 0, 1); }
  function fmtMm(v) { return Number.isFinite(v) ? `${v.toFixed(1)} mm` : "--"; }
  function verdictClass(v) { return v === "OK" ? "ok" : v === "MAL" ? "bad" : "unstable"; }
})();
