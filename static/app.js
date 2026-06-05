(() => {
  const $ = (id) => document.getElementById(id);

  const dom = {
    video: $("video"),
    canvas: $("viewCanvas"),
    hint: $("cameraHint"),
    sessionCode: $("sessionCode"),
    btnCamera: $("btnCamera"),
    btnCalibrate: $("btnCalibrate"),
    btnSaveMaster: $("btnSaveMaster"),
    btnNewPatch: $("btnNewPatch"),
    btnRecalibrate: $("btnRecalibrate"),
    mainState: $("mainState"),
    statusDot: $("statusDot"),
    opencvState: $("opencvState"),
    operatorInstruction: $("operatorInstruction"),
    nextAction: $("nextAction"),
    stepCamera: $("stepCamera"),
    stepCard: $("stepCard"),
    stepMaster: $("stepMaster"),
    stepPatch: $("stepPatch"),
    friendlyCard: $("friendlyCard"),
    friendlyScale: $("friendlyScale"),
    friendlyMaster: $("friendlyMaster"),
    friendlyText: $("friendlyText"),
    liveScale: $("liveScale"),
    lockedScale: $("lockedScale"),
    stability: $("stability"),
    cardState: $("cardState"),
    verdict: $("verdict"),
    scoreValue: $("scoreValue"),
    readConfidence: $("readConfidence"),
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
    version: "4.0.0",
    cvReady: false,
    cameraRunning: false,
    processing: false,
    flow: "camera", // camera | card | master | inspect
    session: getOrCreateSessionCode(),
    ws: null,
    wsConnected: false,
    frameId: null,
    frameCounter: 0,
    lastSentAt: 0,
    liveCard: null,
    smoothCard: null,
    scaleSamples: [],
    calibration: null,
    master: null,
    currentInspection: null,
    smoothInspection: null,
    lastValidInspectionAt: 0,
    payloadHistory: [],
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
    dom.btnSaveMaster.addEventListener("click", saveMasterPatch);
    dom.btnNewPatch.addEventListener("click", () => {
      if (state.calibration && state.master) {
        state.flow = "inspect";
        state.smoothInspection = null;
        updateFlowUi("Coloca el parche dentro del recuadro. Espera a que la lectura se estabilice.");
      } else if (state.calibration) {
        state.flow = "master";
        updateFlowUi("Coloca un parche bueno para guardarlo como muestra correcta.");
      }
    });
    dom.btnRecalibrate.addEventListener("click", () => {
      state.calibration = null;
      state.master = null;
      state.scaleSamples = [];
      state.smoothCard = null;
      state.smoothInspection = null;
      state.currentInspection = null;
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
      loose: { x: 5, y: 6, a: 7, s: 75 },
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
      minReadConfidence: 0.74,
      label: dom.precisionPreset.options[dom.precisionPreset.selectedIndex]?.textContent || "Normal",
    };
  }

  function updateFlowUi(customMessage) {
    const active = state.flow;
    setStep(dom.stepCamera, active === "camera", state.cameraRunning || state.calibration);
    setStep(dom.stepCard, active === "card", Boolean(state.calibration));
    setStep(dom.stepMaster, active === "master", Boolean(state.master));
    setStep(dom.stepPatch, active === "inspect", false);

    let instruction = "Toca “Iniciar cámara”. Luego la app te pedirá la tarjeta 7×7.";
    let action = "Inicia la cámara del celular.";

    if (active === "card") {
      instruction = "Coloca la tarjeta 7×7 dentro del recuadro. No la tapes con el dedo. Cuando diga “lista”, toca Calibrar.";
      action = "Coloca la tarjeta con el cuadro negro 5×5 visible, plano y bien iluminado.";
    } else if (active === "master") {
      instruction = "Retira la tarjeta y coloca un parche que tú consideres correcto. Esta será la muestra buena.";
      action = "Coloca un parche bueno y toca “Guardar parche bueno” cuando el texto se detecte estable.";
    } else if (active === "inspect") {
      instruction = "Coloca el parche de producción. La app lo comparará contra la muestra buena, no contra un centro matemático inventado.";
      action = "Coloca el parche dentro de la guía. Mantén el celular quieto un momento.";
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
        dom.opencvState.textContent = "OpenCV.js no cargó. Recarga con buena conexión.";
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
    state.frameCounter += 1;
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

      let card = null;
      if (state.flow === "card") {
        card = detectCalibrationCard(gray);
        state.liveCard = card;
        state.smoothCard = smoothCard(card);
        updateScaleSamples(state.smoothCard || card);
      }

      const stable = getScaleStability();
      const pxPerMm = state.calibration ? state.calibration.pxPerMm : null;
      let inspection = null;
      if ((state.flow === "master" || state.flow === "inspect") && pxPerMm) {
        const rawInspection = detectPatchAndText(gray, pxPerMm, state.master);
        inspection = smoothInspection(rawInspection);
      }
      state.currentInspection = inspection;

      const payload = buildPayload(state.smoothCard || card, stable, inspection);
      drawOverlay(payload, state.smoothCard || card, inspection);
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

  // ---------- Calibración 7×7 / interior 5×5 ----------

  function detectCalibrationCard(gray) {
    const work = new cv.Mat();
    const blur = new cv.Mat();
    const masks = [];
    let best = null;

    try {
      cv.equalizeHist(gray, work);
      cv.GaussianBlur(work, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

      masks.push(makeThresholdMask(blur, 0, cv.THRESH_BINARY_INV + cv.THRESH_OTSU, "otsu negro"));
      masks.push(makeThresholdMask(blur, 135, cv.THRESH_BINARY_INV, "negro 135"));
      masks.push(makeThresholdMask(blur, 165, cv.THRESH_BINARY_INV, "negro 165"));
      masks.push(makeAdaptiveSquareMask(blur));
      masks.push(makeSquareEdgeMask(blur));

      const frameArea = gray.rows * gray.cols;
      const minSide = Math.min(gray.rows, gray.cols) * 0.065;
      const maxSide = Math.min(gray.rows, gray.cols) * 0.68;

      for (const item of masks) {
        const cleaned = cleanSquareMask(item.mask);
        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        try {
          cv.findContours(cleaned, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
          for (let i = 0; i < contours.size(); i++) {
            const cnt = contours.get(i);
            const area = cv.contourArea(cnt);
            if (area < frameArea * 0.0007 || area > frameArea * 0.38) { cnt.delete(); continue; }

            const rect = cv.minAreaRect(cnt);
            const w = Math.max(rect.size.width, 1);
            const h = Math.max(rect.size.height, 1);
            const side = (w + h) / 2;
            const ratio = Math.max(w, h) / Math.min(w, h);
            const fill = area / Math.max(w * h, 1);
            const bbox = cv.boundingRect(cnt);
            const contrast = estimateDarkSquareContrast(gray, bbox);
            const centerBias = 1 - Math.min(1, distanceNorm(rect.center.x, rect.center.y, gray.cols / 2, gray.rows / 2, gray.cols, gray.rows));
            const anglePenalty = Math.abs(normalizeAngle(rect.angle)) / 45;

            const okSize = side >= minSide && side <= maxSide;
            const okShape = ratio <= 1.34 && fill >= 0.36;
            const okContrast = contrast >= 6;
            if (!okSize || !okShape || !okContrast) { cnt.delete(); continue; }

            const score = area * (0.7 + centerBias * 0.45) * (1 + Math.min(contrast, 75) / 120) * (1 - Math.min(anglePenalty, 0.55) * 0.12);
            if (!best || score > best.score) {
              best = {
                score,
                area,
                rect: cloneRotatedRect(rect),
                bbox,
                sidePx: side,
                pxPerMm: side / 50.0,
                vertices: rectPoints(rect),
                expectedOuter: expectedOuterFromInner(rect, 1.4),
                contrast,
                method: item.name,
              };
            }
            cnt.delete();
          }
        } finally {
          contours.delete(); hierarchy.delete(); cleaned.delete();
        }
      }
    } finally {
      for (const item of masks) item.mask.delete();
      work.delete(); blur.delete();
    }
    return best;
  }

  function makeThresholdMask(src, threshold, type, name) {
    const mask = new cv.Mat();
    cv.threshold(src, mask, threshold, 255, type);
    return { name, mask };
  }

  function makeAdaptiveSquareMask(src) {
    const mask = new cv.Mat();
    let block = Math.max(31, Math.floor(Math.min(src.cols, src.rows) / 7));
    if (block % 2 === 0) block += 1;
    block = Math.min(block, 91);
    cv.adaptiveThreshold(src, mask, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, block, 5);
    return { name: "adaptativo", mask };
  }

  function makeSquareEdgeMask(src) {
    const edges = new cv.Mat();
    const mask = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
    cv.Canny(src, edges, 35, 115, 3, false);
    cv.dilate(edges, mask, kernel, new cv.Point(-1, -1), 1);
    kernel.delete(); edges.delete();
    return { name: "bordes", mask };
  }

  function cleanSquareMask(mask) {
    const cleaned = new cv.Mat();
    const k1 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    const k2 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
    cv.morphologyEx(mask, cleaned, cv.MORPH_OPEN, k1);
    cv.morphologyEx(cleaned, cleaned, cv.MORPH_CLOSE, k2);
    k1.delete(); k2.delete();
    return cleaned;
  }

  function estimateDarkSquareContrast(gray, bbox) {
    const x = clamp(bbox.x, 0, gray.cols - 2);
    const y = clamp(bbox.y, 0, gray.rows - 2);
    const w = clamp(bbox.width, 2, gray.cols - x);
    const h = clamp(bbox.height, 2, gray.rows - y);
    const grow = Math.round(Math.max(w, h) * 0.22);
    const ex = clamp(x - grow, 0, gray.cols - 2);
    const ey = clamp(y - grow, 0, gray.rows - 2);
    const er = clamp(x + w + grow, ex + 2, gray.cols);
    const eb = clamp(y + h + grow, ey + 2, gray.rows);
    const inner = gray.roi(new cv.Rect(x, y, w, h));
    const outer = gray.roi(new cv.Rect(ex, ey, er - ex, eb - ey));
    try {
      const mi = cv.mean(inner)[0];
      const mo = cv.mean(outer)[0];
      return mo - mi;
    } finally {
      inner.delete(); outer.delete();
    }
  }

  function expectedOuterFromInner(rect, factor) {
    return {
      center: { x: rect.center.x, y: rect.center.y },
      size: { width: rect.size.width * factor, height: rect.size.height * factor },
      angle: rect.angle,
    };
  }

  function smoothCard(card) {
    if (!card) return state.smoothCard;
    if (!state.smoothCard) return card;
    const a = 0.22;
    const prev = state.smoothCard;
    const rect = {
      center: {
        x: lerp(prev.rect.center.x, card.rect.center.x, a),
        y: lerp(prev.rect.center.y, card.rect.center.y, a),
      },
      size: {
        width: lerp(prev.rect.size.width, card.rect.size.width, a),
        height: lerp(prev.rect.size.height, card.rect.size.height, a),
      },
      angle: lerpAngle(prev.rect.angle, card.rect.angle, a),
    };
    const side = (rect.size.width + rect.size.height) / 2;
    return {
      ...card,
      rect,
      sidePx: side,
      pxPerMm: side / 50,
      vertices: boxPoints(rect.center, rect.size.width, rect.size.height, rect.angle),
      expectedOuter: expectedOuterFromInner(rect, 1.4),
    };
  }

  function updateScaleSamples(card) {
    if (!card || !Number.isFinite(card.pxPerMm)) return;
    const sample = { value: card.pxPerMm, x: card.rect.center.x, y: card.rect.center.y, t: performance.now(), contrast: card.contrast || 0 };
    state.scaleSamples.push(sample);
    if (state.scaleSamples.length > 18) state.scaleSamples.shift();
  }

  function getScaleStability() {
    const samples = state.scaleSamples.slice(-12);
    if (samples.length < 7) return { ok: false, label: "Esperando", average: null, cv: null, drift: null };
    const values = samples.map((s) => s.value);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / values.length;
    const std = Math.sqrt(variance);
    const cvValue = std / Math.max(avg, 0.0001);
    const xs = samples.map((s) => s.x);
    const ys = samples.map((s) => s.y);
    const drift = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const contrastAvg = samples.map(s => s.contrast).reduce((a,b)=>a+b,0)/samples.length;
    const ok = cvValue < 0.035 && drift < 24 && contrastAvg > 6;
    return { ok, label: ok ? "Lista" : "Movida", average: avg, cv: cvValue, drift, contrastAvg };
  }

  function lockCalibration() {
    const stable = getScaleStability();
    if (!state.liveCard || !stable.average || !stable.ok) return;
    state.calibration = {
      pxPerMm: stable.average,
      lockedAt: new Date().toISOString(),
      source: "Tarjeta 7×7 cm / interior negro 5×5 cm",
    };
    state.flow = "master";
    state.smoothInspection = null;
    dom.lockedScale.textContent = `${stable.average.toFixed(2)} px/mm`;
    setMainState("COLOCA MUESTRA", "ok");
    updateFlowUi("Calibración guardada. Retira la tarjeta y coloca un parche BUENO para usarlo como muestra correcta.");
  }

  // ---------- Detección parche/texto ----------

  function detectPatchAndText(gray, pxPerMm, master) {
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
      cv.Canny(blur, edges, 30, 105, 3, false);
      kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
      cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), 1);
      cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      const frameArea = gray.rows * gray.cols;
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area < frameArea * 0.004 || area > frameArea * 0.72) { cnt.delete(); continue; }

        const rect = cv.minAreaRect(cnt);
        const w = Math.max(rect.size.width, 1);
        const h = Math.max(rect.size.height, 1);
        const ratio = Math.max(w, h) / Math.min(w, h);
        if (ratio > 5.2 || Math.min(w, h) < 22) { cnt.delete(); continue; }

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

      const text = detectTextInsidePatch(gray, bestContour, patchRect, pxPerMm, master);
      if (!text) return { patch, text: null, metrics: null };

      const metrics = computeAlignmentMetricsFromPlain(patch, text, pxPerMm);
      return { patch, text, metrics };
    } finally {
      if (bestContour) bestContour.delete();
      blur.delete(); edges.delete(); dilated.delete(); contours.delete(); hierarchy.delete(); if (kernel) kernel.delete();
    }
  }

  function detectTextInsidePatch(gray, patchContour, patchRect, pxPerMm, master) {
    const bbox = cv.boundingRect(patchContour);
    const pad = Math.max(7, Math.round(2.6 * pxPerMm));
    const x = clamp(Math.floor(bbox.x + pad), 0, gray.cols - 1);
    const y = clamp(Math.floor(bbox.y + pad), 0, gray.rows - 1);
    const right = clamp(Math.ceil(bbox.x + bbox.width - pad), x + 1, gray.cols);
    const bottom = clamp(Math.ceil(bbox.y + bbox.height - pad), y + 1, gray.rows);
    const w = right - x;
    const h = bottom - y;
    if (w < 25 || h < 20) return null;

    const roi = gray.roi(new cv.Rect(x, y, w, h));
    const eq = new cv.Mat();
    const blur = new cv.Mat();
    cv.equalizeHist(roi, eq);
    cv.GaussianBlur(eq, blur, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);

    const patchInfo = normalizedRectInfo(patchRect);
    const expected = expectedTextCenterFromMaster(patchInfo, master, pxPerMm);
    const masks = [];
    try {
      masks.push(makeAdaptiveMask(blur, true));
      masks.push(makeAdaptiveMask(blur, false));
      masks.push(makeOtsuMask(blur, true));
      masks.push(makeOtsuMask(blur, false));
      masks.push(makeEdgeTextMask(blur));

      let best = null;
      for (const item of masks) {
        const candidate = collectTextCandidateFromMask(item.mask, x, y, w, h, pxPerMm, item.name, expected, master);
        if (candidate && (!best || candidate.score > best.score)) best = candidate;
      }

      if (!best || !best.points || best.points.length < 10 || !best.union) return null;

      const pointMat = cv.matFromArray(best.points.length / 2, 1, cv.CV_32SC2, best.points);
      const textRect = cv.minAreaRect(pointMat);
      pointMat.delete();
      const info = normalizedRectInfo(textRect);

      if (info.width > w * 0.95 || info.height > h * 0.80) return null;

      return {
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
      blur.delete(); eq.delete(); roi.delete();
    }
  }

  function expectedTextCenterFromMaster(patchInfo, master, pxPerMm) {
    if (!master || !master.alignment) return null;
    const theta = degToRad(patchInfo.angle);
    const ux = { x: Math.cos(theta), y: Math.sin(theta) };
    const uy = { x: -Math.sin(theta), y: Math.cos(theta) };
    const dx = master.alignment.offsetXmm * pxPerMm;
    const dy = master.alignment.offsetYmm * pxPerMm;
    return {
      x: patchInfo.center.x + ux.x * dx + uy.x * dy,
      y: patchInfo.center.y + ux.y * dx + uy.y * dy,
      widthMm: master.text?.widthMm || null,
      heightMm: master.text?.heightMm || null,
    };
  }

  function makeAdaptiveMask(src, inverse) {
    const mask = new cv.Mat();
    const minSide = Math.min(src.cols, src.rows);
    let block = Math.max(15, Math.floor(minSide / 3));
    if (block % 2 === 0) block += 1;
    block = Math.min(block, 65);
    cv.adaptiveThreshold(src, mask, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, inverse ? cv.THRESH_BINARY_INV : cv.THRESH_BINARY, block, 7);
    postProcessTextMask(mask);
    return { name: inverse ? "texto oscuro" : "texto claro", mask };
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
    cv.Canny(src, edges, 30, 100, 3, false);
    edges.copyTo(mask);
    edges.delete();
    postProcessTextMask(mask, true);
    return { name: "bordes", mask };
  }

  function postProcessTextMask(mask, edgeMode) {
    const k1 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(edgeMode ? 3 : 2, 2));
    const k2 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(edgeMode ? 8 : 7, 3));
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, k1);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, k2);
    k1.delete(); k2.delete();
  }

  function collectTextCandidateFromMask(mask, originX, originY, roiW, roiH, pxPerMm, method, expected, master) {
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    let union = null;
    let points = [];
    let kept = 0;
    let inkArea = 0;

    try {
      cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const roiArea = roiW * roiH;
      const minArea = Math.max(6, roiArea * 0.00010);
      const maxArea = roiArea * 0.25;
      const minH = Math.max(3, 0.35 * pxPerMm);
      const maxH = roiH * 0.62;

      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const b = cv.boundingRect(cnt);
        const boxArea = b.width * b.height;
        const area = Math.max(cv.contourArea(cnt), boxArea * 0.18);
        const touchesBorder = b.x < roiW * 0.008 || b.y < roiH * 0.008 || (b.x + b.width) > roiW * 0.992 || (b.y + b.height) > roiH * 0.992;
        const tooBig = boxArea > maxArea || b.width > roiW * 0.94 || b.height > maxH;
        const tooSmall = boxArea < minArea || b.width < 2 || b.height < minH;
        const tooSkinnyTall = b.height > b.width * 8;
        if (!tooSmall && !tooBig && !touchesBorder && !tooSkinnyTall) {
          const globalB = { x: originX + b.x, y: originY + b.y, width: b.width, height: b.height };
          union = union ? unionRect(union, globalB) : globalB;
          inkArea += area;
          kept++;
          const data = cnt.data32S;
          for (let p = 0; p < data.length; p += 2) points.push(data[p] + originX, data[p + 1] + originY);
        }
        cnt.delete();
      }

      if (!union || kept < 1 || points.length < 10) return null;
      const unionArea = union.width * union.height;
      const unionCx = union.x + union.width / 2;
      const unionCy = union.y + union.height / 2;
      const unionLocalCx = unionCx - originX;
      const unionLocalCy = unionCy - originY;
      const centerPenalty = distanceNorm(unionLocalCx, unionLocalCy, roiW / 2, roiH / 2, roiW, roiH);
      const targetPenalty = expected ? distanceNorm(unionCx, unionCy, expected.x, expected.y, roiW, roiH) : centerPenalty;
      const fill = inkArea / Math.max(unionArea, 1);
      const saneSize = union.width > roiW * 0.035 && union.height > roiH * 0.018 && unionArea < roiArea * 0.44;
      if (!saneSize || fill < 0.010) return null;

      let sizeBonus = 0;
      if (master && expected && expected.widthMm && expected.heightMm) {
        const wm = union.width / pxPerMm;
        const hm = union.height / pxPerMm;
        const wRatio = Math.abs(wm - expected.widthMm) / Math.max(expected.widthMm, 1);
        const hRatio = Math.abs(hm - expected.heightMm) / Math.max(expected.heightMm, 1);
        sizeBonus = (1 - clamp01((wRatio + hRatio) / 1.2)) * 160;
      }

      const proximity = 1 - clamp01(targetPenalty * 2.2);
      const center = 1 - clamp01(centerPenalty * 1.7);
      const score = (unionArea * 0.07) + (kept * 95) + (fill * 850) + (expected ? proximity * 260 : center * 140) + sizeBonus;
      const confidence = clamp01((kept / 8) * 0.28 + Math.min(1, fill * 6.5) * 0.30 + (expected ? proximity * 0.32 : center * 0.27) + (sizeBonus > 0 ? 0.10 : 0.03));
      return { union, points, kept, inkArea, score, confidence, method };
    } finally {
      contours.delete(); hierarchy.delete();
    }
  }

  // ---------- Métricas, muestra correcta y suavizado ----------

  function computeAlignmentMetricsFromPlain(patch, text, pxPerMm) {
    const theta = degToRad(patch.angleDeg);
    const ux = { x: Math.cos(theta), y: Math.sin(theta) };
    const uy = { x: -Math.sin(theta), y: Math.cos(theta) };

    const rel = { x: text.center.x - patch.center.x, y: text.center.y - patch.center.y };
    const offsetXPx = rel.x * ux.x + rel.y * ux.y;
    const offsetYPx = rel.x * uy.x + rel.y * uy.y;

    const textVertices = text.vertices;
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

    const halfW = patch.widthPx / 2;
    const halfH = patch.heightPx / 2;
    const left = (minX + halfW) / pxPerMm;
    const right = (halfW - maxX) / pxPerMm;
    const top = (minY + halfH) / pxPerMm;
    const bottom = (halfH - maxY) / pxPerMm;

    return {
      offsetXmm: offsetXPx / pxPerMm,
      offsetYmm: offsetYPx / pxPerMm,
      angleDeg: normalizeAngle(text.angleDeg - patch.angleDeg),
      edges: { left, right, top, bottom },
      plain: {
        horizontal: plainHorizontal(offsetXPx / pxPerMm),
        vertical: plainVertical(offsetYPx / pxPerMm),
      },
    };
  }

  function saveMasterPatch() {
    const ins = state.currentInspection;
    if (!ins || !ins.patch || !ins.text || !ins.metrics) return;
    if ((ins.text.confidence || 0) < 0.68) return;
    state.master = {
      savedAt: new Date().toISOString(),
      patch: simplePatch(ins.patch),
      text: simpleText(ins.text),
      alignment: JSON.parse(JSON.stringify(ins.metrics)),
    };
    state.flow = "inspect";
    state.smoothInspection = null;
    setMainState("INSPECCIONANDO", "ok");
    updateFlowUi("Muestra correcta guardada. Ahora coloca los parches de producción para compararlos contra esa referencia.");
  }

  function smoothInspection(current) {
    const now = performance.now();
    if (!current || !current.patch) {
      if (state.smoothInspection && now - state.lastValidInspectionAt < 450) {
        return { ...state.smoothInspection, stale: true };
      }
      return null;
    }
    state.lastValidInspectionAt = now;
    if (!state.smoothInspection || !state.smoothInspection.patch) {
      state.smoothInspection = current;
      return current;
    }
    const prev = state.smoothInspection;
    const alphaPatch = 0.24;
    const alphaText = 0.22;
    const patch = smoothPlainBox(prev.patch, current.patch, alphaPatch);
    let text = current.text;
    if (current.text && prev.text) text = smoothPlainBox(prev.text, current.text, alphaText);
    if (text) text.confidence = current.text.confidence;

    let metrics = null;
    if (patch && text && state.calibration) metrics = computeAlignmentMetricsFromPlain(patch, text, state.calibration.pxPerMm);
    const smoothed = { patch, text, metrics };
    state.smoothInspection = smoothed;
    return smoothed;
  }

  function smoothPlainBox(prev, cur, alpha) {
    const out = {
      ...cur,
      center: {
        x: lerp(prev.center.x, cur.center.x, alpha),
        y: lerp(prev.center.y, cur.center.y, alpha),
      },
      widthPx: lerp(prev.widthPx, cur.widthPx, alpha),
      heightPx: lerp(prev.heightPx, cur.heightPx, alpha),
      widthMm: lerp(prev.widthMm, cur.widthMm, alpha),
      heightMm: lerp(prev.heightMm, cur.heightMm, alpha),
      angleDeg: lerpAngle(prev.angleDeg, cur.angleDeg, alpha),
    };
    out.vertices = boxPoints(out.center, out.widthPx, out.heightPx, out.angleDeg);
    return out;
  }

  function simplePatch(p) {
    return { widthMm: p.widthMm, heightMm: p.heightMm, angleDeg: p.angleDeg };
  }
  function simpleText(t) {
    return { widthMm: t.widthMm, heightMm: t.heightMm, angleDeg: t.angleDeg, confidence: t.confidence };
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
      cardContrast: card ? card.contrast : null,
    };

    let verdict = "ESPERA";
    let score = null;
    let detectionConfidence = null;
    let reason = "Inicia la cámara para comenzar.";
    let stateLabel = "SIN CÁMARA";
    let comparison = null;

    if (state.flow === "card") {
      stateLabel = "COLOCA TARJETA";
      if (card && stable.ok) {
        verdict = "ESPERA";
        reason = "Tarjeta lista. Toca “Calibrar tarjeta 7×7”.";
      } else if (card) {
        verdict = "INESTABLE";
        reason = "Tarjeta detectada. No muevas el celular ni tapes la tarjeta con el dedo.";
      } else {
        verdict = "INESTABLE";
        reason = "No veo la tarjeta. Evita reflejos; el cuadro negro debe verse oscuro contra el fondo blanco.";
      }
    } else if (state.flow === "master") {
      stateLabel = "GUARDA MUESTRA";
      verdict = "MUESTRA";
      if (!inspection || !inspection.patch) {
        reason = "Coloca un parche bueno dentro del recuadro.";
      } else if (!inspection.text || !inspection.metrics) {
        reason = "Veo el parche, pero todavía no confirmo el texto. Acerca un poco o mejora la luz.";
      } else {
        detectionConfidence = inspection.text.confidence || 0;
        if (detectionConfidence < 0.68) {
          reason = "Texto dudoso. Ajusta luz o distancia antes de guardar la muestra.";
        } else {
          reason = "Lectura suficiente. Toca “Guardar parche bueno”.";
        }
      }
    } else if (state.flow === "inspect") {
      stateLabel = "INSPECCIONANDO";
      verdict = "INESTABLE";
      if (!inspection || !inspection.patch) {
        reason = "Buscando el borde del parche. Acerca la prenda y evita sombras fuertes.";
      } else if (!inspection.text || !inspection.metrics) {
        verdict = "NO LEE";
        reason = "Veo el parche, pero no confirmo el texto. No se rechaza: repite lectura.";
      } else {
        detectionConfidence = inspection.text.confidence || 0;
        comparison = compareWithMaster(inspection.metrics);
        score = calculateScore(comparison || inspection.metrics, tolerances);
        if (detectionConfidence < tolerances.minReadConfidence) {
          verdict = "REVISAR";
          reason = "Lectura insegura. No rechazar pieza todavía; repite con mejor luz o menor movimiento.";
        } else if (score >= tolerances.scoreMin) {
          verdict = "OK";
          reason = state.master ? "Aprobado. Coincide con la muestra buena." : "Aprobado. Texto dentro de tolerancia.";
        } else {
          verdict = "MAL";
          reason = state.master ? "Revisar. Se aleja de la muestra buena." : "Revisar. Texto fuera de tolerancia.";
        }
      }
    }

    return {
      type: "inspection",
      version: state.version,
      session: state.session,
      timestamp: new Date().toISOString(),
      flow: state.flow,
      state: stateLabel,
      verdict,
      score,
      detectionConfidence,
      reason,
      calibration,
      tolerances,
      master: state.master ? {
        savedAt: state.master.savedAt,
        patch: state.master.patch,
        text: state.master.text,
        alignment: state.master.alignment,
      } : null,
      comparison,
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

  function compareWithMaster(metrics) {
    if (!state.master || !state.master.alignment || !metrics) return null;
    const ref = state.master.alignment;
    return {
      offsetXmm: metrics.offsetXmm - ref.offsetXmm,
      offsetYmm: metrics.offsetYmm - ref.offsetYmm,
      angleDeg: normalizeAngle(metrics.angleDeg - ref.angleDeg),
      edges: {
        left: metrics.edges.left - ref.edges.left,
        right: metrics.edges.right - ref.edges.right,
        top: metrics.edges.top - ref.edges.top,
        bottom: metrics.edges.bottom - ref.edges.bottom,
      },
      plain: {
        horizontal: plainHorizontal(metrics.offsetXmm - ref.offsetXmm),
        vertical: plainVertical(metrics.offsetYmm - ref.offsetYmm),
      },
    };
  }

  function calculateScore(metricsOrComparison, tolerances) {
    const sx = clamp01(1 - Math.abs(metricsOrComparison.offsetXmm) / Math.max(tolerances.xMm, 0.001));
    const sy = clamp01(1 - Math.abs(metricsOrComparison.offsetYmm) / Math.max(tolerances.yMm, 0.001));
    const sa = clamp01(1 - Math.abs(metricsOrComparison.angleDeg) / Math.max(tolerances.angleDeg, 0.001));
    return Math.round((sx * 0.40 + sy * 0.40 + sa * 0.20) * 100);
  }

  // ---------- Dibujo, UI y WebSocket ----------

  function drawOverlay(payload, card, inspection) {
    drawGuide(ctx);

    if (card) {
      drawPoly(ctx, card.expectedOuter ? boxPoints(card.expectedOuter.center, card.expectedOuter.size.width, card.expectedOuter.size.height, card.expectedOuter.angle) : [], "#0f766e", 2);
      drawPoly(ctx, card.vertices, "#0b5fff", 3);
      drawLabel(ctx, card.rect.center.x + 8, card.rect.center.y - 8, "Cuadro 5×5 detectado");
    }

    if (inspection && inspection.patch) {
      drawPoly(ctx, inspection.patch.vertices, verdictColor(payload.verdict), 4);
      drawCross(ctx, inspection.patch.center.x, inspection.patch.center.y, "#0b5fff", 18);
      drawLabel(ctx, inspection.patch.center.x + 10, inspection.patch.center.y + 16, "Centro parche");
    }

    if (inspection && inspection.text) {
      drawPoly(ctx, inspection.text.vertices, "#b7791f", 3);
      drawCross(ctx, inspection.text.center.x, inspection.text.center.y, "#b7791f", 14);
      drawLabel(ctx, inspection.text.center.x + 10, inspection.text.center.y - 14, "Texto detectado");
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
    const color = state.flow === "card" ? "rgba(15, 118, 110, 0.70)" : "rgba(11,95,255,0.65)";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(x, y, size, size);
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.fillRect(x + 10, y + 10, 390, 34);
    ctx.fillStyle = state.flow === "card" ? "#0f766e" : "#0b5fff";
    ctx.font = "800 15px system-ui";
    let label = "Guía: tarjeta 7×7 cm";
    if (state.flow === "master") label = "Guía: parche bueno de muestra";
    if (state.flow === "inspect") label = "Guía: parche de producción";
    ctx.fillText(label, x + 22, y + 32);
    ctx.restore();
  }

  function drawTopBanner(ctx, payload) {
    const text = `${payload.verdict} · ${payload.reason}`;
    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.fillRect(12, 12, Math.min(dom.canvas.width - 24, 850), 48);
    ctx.strokeStyle = "rgba(16,32,51,0.16)";
    ctx.strokeRect(12, 12, Math.min(dom.canvas.width - 24, 850), 48);
    ctx.fillStyle = verdictColor(payload.verdict);
    ctx.font = "850 18px system-ui";
    ctx.fillText(text.substring(0, 98), 24, 43);
    ctx.restore();
  }

  function updateUi(payload) {
    state.lastPayload = payload;
    const c = payload.calibration;
    dom.liveScale.textContent = c.livePxPerMm ? `${c.livePxPerMm.toFixed(2)} px/mm` : "--";
    dom.lockedScale.textContent = c.pxPerMm ? `${c.pxPerMm.toFixed(2)} px/mm` : "--";
    dom.stability.textContent = c.stabilityLabel || "--";
    dom.cardState.textContent = c.cardDetected ? "Detectada" : "No detectada";
    dom.friendlyCard.textContent = c.cardDetected ? (c.stable ? "Lista" : "No mover") : "No detectada";
    dom.friendlyScale.textContent = c.locked ? "Calibrada" : "Sin calibrar";
    dom.friendlyMaster.textContent = state.master ? "Guardada" : "Pendiente";

    dom.btnCalibrate.disabled = !(state.flow === "card" && state.liveCard && getScaleStability().ok);
    const canSaveMaster = state.flow === "master" && state.currentInspection && state.currentInspection.text && (state.currentInspection.text.confidence || 0) >= 0.68;
    dom.btnSaveMaster.disabled = !canSaveMaster;

    setMainState(payload.state, statusMode(payload.verdict));
    setVerdict(payload.verdict, payload.score, payload.detectionConfidence);
    dom.reasonText.textContent = payload.reason;

    const m = payload.measurements;
    const displayMetrics = payload.comparison || (m && m.alignment ? m.alignment : null);
    if (!displayMetrics) {
      dom.dxValue.textContent = "--";
      dom.dyValue.textContent = "--";
      dom.angleValue.textContent = "--";
      dom.edgeLeft.textContent = "--";
      dom.edgeRight.textContent = "--";
      dom.edgeTop.textContent = "--";
      dom.edgeBottom.textContent = "--";
    } else {
      dom.dxValue.textContent = friendlyOffsetX(displayMetrics.offsetXmm);
      dom.dyValue.textContent = friendlyOffsetY(displayMetrics.offsetYmm);
      dom.angleValue.textContent = `${displayMetrics.angleDeg.toFixed(1)}°`;
      dom.edgeLeft.textContent = fmtMm(displayMetrics.edges.left);
      dom.edgeRight.textContent = fmtMm(displayMetrics.edges.right);
      dom.edgeTop.textContent = fmtMm(displayMetrics.edges.top);
      dom.edgeBottom.textContent = fmtMm(displayMetrics.edges.bottom);
    }

    if (m && m.patch) dom.patchSize.textContent = `${m.patch.widthMm.toFixed(1)} × ${m.patch.heightMm.toFixed(1)} mm`;
    else dom.patchSize.textContent = "--";

    if (m && m.text) {
      dom.textSize.textContent = `${m.text.widthMm.toFixed(1)} × ${m.text.heightMm.toFixed(1)} mm`;
      dom.friendlyText.textContent = `Detectado (${Math.round((m.text.confidence || 0) * 100)}%)`;
    } else {
      dom.textSize.textContent = "--";
      dom.friendlyText.textContent = state.flow === "inspect" && m && m.patch ? "No confirmado" : "Pendiente";
    }
  }

  function setVerdict(verdict, score, confidence) {
    dom.verdict.textContent = verdict;
    dom.verdict.className = "verdict " + verdictClass(verdict);
    dom.scoreValue.textContent = Number.isFinite(score) ? `${score}%` : "--%";
    dom.readConfidence.textContent = Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : "--%";
  }

  function setMainState(text, mode) {
    dom.mainState.textContent = text;
    dom.statusDot.className = `status-dot ${mode || "unstable"}`;
  }

  function maybeSend(payload) {
    const now = Date.now();
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    if (now - state.lastSentAt < 220) return;
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

  // ---------- Utilidades visuales/matemáticas ----------

  function cloneRotatedRect(rect) {
    return { center: { x: rect.center.x, y: rect.center.y }, size: { width: rect.size.width, height: rect.size.height }, angle: rect.angle };
  }

  function rectPoints(rect) {
    if (!rect) return [];
    const pts = cv.RotatedRect.points(rect);
    return pts.map((p) => ({ x: p.x, y: p.y }));
  }

  function boxPoints(center, width, height, angleDeg) {
    const a = degToRad(angleDeg || 0);
    const ux = { x: Math.cos(a), y: Math.sin(a) };
    const uy = { x: -Math.sin(a), y: Math.cos(a) };
    const hw = width / 2;
    const hh = height / 2;
    return [
      { x: center.x - ux.x * hw - uy.x * hh, y: center.y - ux.y * hw - uy.y * hh },
      { x: center.x + ux.x * hw - uy.x * hh, y: center.y + ux.y * hw - uy.y * hh },
      { x: center.x + ux.x * hw + uy.x * hh, y: center.y + ux.y * hw + uy.y * hh },
      { x: center.x - ux.x * hw + uy.x * hh, y: center.y - ux.y * hw + uy.y * hh },
    ];
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
    if (Math.abs(mm) < 0.15) return state.master ? "Igual que muestra" : "Centrado";
    return `${Math.abs(mm).toFixed(1)} mm ${mm > 0 ? "derecha" : "izquierda"}`;
  }
  function friendlyOffsetY(mm) {
    if (!Number.isFinite(mm)) return "--";
    if (Math.abs(mm) < 0.15) return state.master ? "Igual que muestra" : "Centrado";
    return `${Math.abs(mm).toFixed(1)} mm ${mm > 0 ? "abajo" : "arriba"}`;
  }

  function verdictColor(v) {
    if (v === "OK") return "#12805c";
    if (v === "MAL") return "#c53030";
    if (v === "REVISAR") return "#b7791f";
    if (v === "NO LEE") return "#718096";
    if (v === "MUESTRA") return "#0f766e";
    return "#718096";
  }
  function verdictClass(v) {
    if (v === "OK") return "ok";
    if (v === "MAL") return "bad";
    if (v === "REVISAR") return "revisar";
    if (v === "NO LEE") return "nolee";
    if (v === "MUESTRA") return "muestra";
    return "unstable";
  }
  function statusMode(v) {
    if (v === "OK") return "ok";
    if (v === "MAL") return "bad";
    if (v === "REVISAR") return "revisar";
    if (v === "NO LEE") return "nolee";
    if (v === "MUESTRA") return "muestra";
    return "warn";
  }

  function degToRad(deg) { return deg * Math.PI / 180; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpAngle(a, b, t) { return a + normalizeAngle(b - a) * t; }
  function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
  function clamp01(v) { return clamp(v, 0, 1); }
  function fmtMm(v) { return Number.isFinite(v) ? `${v.toFixed(1)} mm` : "--"; }
})();
