(() => {
  const $ = (id) => document.getElementById(id);

  const dom = {
    video: $("video"),
    canvas: $("viewCanvas"),
    hint: $("cameraHint"),
    sessionCode: $("sessionCode"),
    btnCamera: $("btnCamera"),
    btnMarkPatch: $("btnMarkPatch"),
    btnMarkText: $("btnMarkText"),
    btnSaveMaster: $("btnSaveMaster"),
    btnStartInspect: $("btnStartInspect"),
    btnFreeze: $("btnFreeze"),
    btnNewMaster: $("btnNewMaster"),
    btnClearMaster: $("btnClearMaster"),
    btnUsePatchScale: $("btnUsePatchScale"),
    btnCalibrateCard: $("btnCalibrateCard"),
    mainState: $("mainState"),
    statusDot: $("statusDot"),
    opencvState: $("opencvState"),
    operatorInstruction: $("operatorInstruction"),
    nextAction: $("nextAction"),
    stepCamera: $("stepCamera"),
    stepMaster: $("stepMaster"),
    stepInspect: $("stepInspect"),
    friendlyPatch: $("friendlyPatch"),
    friendlyText: $("friendlyText"),
    friendlyMaster: $("friendlyMaster"),
    friendlyScale: $("friendlyScale"),
    verdict: $("verdict"),
    qualityValue: $("qualityValue"),
    readConfidence: $("readConfidence"),
    reasonText: $("reasonText"),
    dxValue: $("dxValue"),
    dyValue: $("dyValue"),
    visualMatch: $("visualMatch"),
    patchSize: $("patchSize"),
    textSize: $("textSize"),
    precisionPreset: $("precisionPreset"),
    patchRealW: $("patchRealW"),
    patchRealH: $("patchRealH"),
    lockedScale: $("lockedScale"),
    tolX: $("tolX"),
    tolY: $("tolY"),
    scoreMin: $("scoreMin"),
    confMin: $("confMin"),
    tolXLabel: $("tolXLabel"),
    tolYLabel: $("tolYLabel"),
    scoreMinLabel: $("scoreMinLabel"),
    confMinLabel: $("confMinLabel"),
  };

  const ctx = dom.canvas.getContext("2d", { alpha: false });

  const state = {
    version: "6.0.0",
    session: getOrCreateSessionCode(),
    cvReady: false,
    cameraRunning: false,
    frozen: false,
    flow: "camera", // camera | master | inspect
    ws: null,
    wsConnected: false,
    frameCounter: 0,
    lastSentAt: 0,
    rawCanvas: document.createElement("canvas"),
    rawCtx: null,
    markingMode: null, // patch | text | null
    markStart: null,
    markCurrent: null,
    patchCandidate: null,
    textCandidate: null,
    master: null,
    template: null,
    lastInspection: null,
    smoothInspection: null,
    lastGoodInspectionAt: 0,
    pxPerMm: null,
    scaleSource: "Sin mm",
  };

  state.rawCtx = state.rawCanvas.getContext("2d", { alpha: false });
  dom.sessionCode.textContent = state.session;

  setupControls();
  setupPointerMarking();
  loadMasterFromStorage();
  waitForOpenCv();
  connectWebSocket();
  updateUi();

  function getOrCreateSessionCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    let code = "";
    for (let i = 0; i < 3; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code + String(Math.floor(100 + Math.random() * 900));
  }

  function setupControls() {
    dom.btnCamera.addEventListener("click", startCamera);
    dom.btnMarkPatch.addEventListener("click", () => startMarking("patch"));
    dom.btnMarkText.addEventListener("click", () => startMarking("text"));
    dom.btnSaveMaster.addEventListener("click", saveMaster);
    dom.btnStartInspect.addEventListener("click", startInspect);
    dom.btnFreeze.addEventListener("click", toggleFreeze);
    dom.btnNewMaster.addEventListener("click", newMaster);
    dom.btnClearMaster.addEventListener("click", clearMaster);
    dom.btnUsePatchScale.addEventListener("click", usePatchAsScale);
    dom.btnCalibrateCard.addEventListener("click", calibrateWithCard);
    dom.precisionPreset.addEventListener("change", applyPreset);
    [dom.tolX, dom.tolY, dom.scoreMin, dom.confMin].forEach((el) => el.addEventListener("input", updateToleranceLabels));
    applyPreset();
  }

  function applyPreset() {
    const preset = dom.precisionPreset.value;
    const values = {
      strict: { x: 2, y: 2.5, s: 90, c: 82 },
      normal: { x: 3, y: 4, s: 85, c: 75 },
      loose: { x: 5, y: 6, s: 75, c: 65 },
    }[preset] || { x: 3, y: 4, s: 85, c: 75 };
    dom.tolX.value = values.x;
    dom.tolY.value = values.y;
    dom.scoreMin.value = values.s;
    dom.confMin.value = values.c;
    updateToleranceLabels();
  }

  function updateToleranceLabels() {
    dom.tolXLabel.textContent = `${Number(dom.tolX.value).toFixed(1)}%`;
    dom.tolYLabel.textContent = `${Number(dom.tolY.value).toFixed(1)}%`;
    dom.scoreMinLabel.textContent = `${Number(dom.scoreMin.value).toFixed(0)}%`;
    dom.confMinLabel.textContent = `${Number(dom.confMin.value).toFixed(0)}%`;
  }

  function tolerances() {
    return {
      xPct: Number(dom.tolX.value),
      yPct: Number(dom.tolY.value),
      scoreMin: Number(dom.scoreMin.value),
      confMin: Number(dom.confMin.value),
    };
  }

  function waitForOpenCv() {
    const start = Date.now();
    const timer = setInterval(() => {
      if (window.cv && cv.Mat && cv.imread && cv.matchTemplate) {
        clearInterval(timer);
        state.cvReady = true;
        dom.opencvState.textContent = "OpenCV.js listo";
        if (state.master && !state.template) rebuildTemplateFromMaster();
        updateUi();
      } else if (Date.now() - start > 25000) {
        clearInterval(timer);
        dom.opencvState.textContent = "OpenCV.js no cargó. Recarga la página con buena conexión.";
      }
    }, 250);
  }

  async function startCamera() {
    try {
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
      resizeCanvas();
      state.cameraRunning = true;
      state.frozen = false;
      state.flow = state.master ? "inspect" : "master";
      dom.hint.style.display = "none";
      dom.btnCamera.textContent = "Cámara activa";
      dom.btnCamera.disabled = true;
      dom.btnFreeze.disabled = false;
      setMainState(state.master ? "INSPECCIONANDO" : "CREA MUESTRA", state.master ? "ok" : "warn");
      updateUi();
      loop();
    } catch (err) {
      console.error(err);
      setMainState("ERROR DE CÁMARA", "bad");
      dom.opencvState.textContent = "No se pudo abrir la cámara. Revisa permisos del navegador.";
    }
  }

  function resizeCanvas() {
    const vw = dom.video.videoWidth || 1280;
    const vh = dom.video.videoHeight || 720;
    dom.canvas.width = vw;
    dom.canvas.height = vh;
    state.rawCanvas.width = vw;
    state.rawCanvas.height = vh;
  }

  function loop() {
    if (!state.cameraRunning) return;
    if (!state.frozen) {
      state.rawCtx.drawImage(dom.video, 0, 0, state.rawCanvas.width, state.rawCanvas.height);
    }
    drawBaseFrame();

    if (state.flow === "inspect" && state.master && state.template && state.cvReady && !state.markingMode) {
      // Baja frecuencia = menos brincos. La pantalla sigue fluida, la medición no se vuelve epilepsia corporativa.
      if (state.frameCounter % 5 === 0) {
        const inspection = inspectCurrentFrame();
        if (inspection) {
          state.lastInspection = inspection;
          state.smoothInspection = smoothInspection(state.smoothInspection, inspection);
          state.lastGoodInspectionAt = Date.now();
        }
      }
    }

    drawOverlay();
    renderMeasurements();
    publishTelemetryThrottled();

    state.frameCounter += 1;
    requestAnimationFrame(loop);
  }

  function drawBaseFrame() {
    ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
    ctx.drawImage(state.rawCanvas, 0, 0);
  }

  function setupPointerMarking() {
    dom.canvas.addEventListener("pointerdown", (ev) => {
      if (!state.markingMode) return;
      ev.preventDefault();
      dom.canvas.setPointerCapture(ev.pointerId);
      const p = eventToCanvasPoint(ev);
      state.markStart = p;
      state.markCurrent = p;
    });
    dom.canvas.addEventListener("pointermove", (ev) => {
      if (!state.markingMode || !state.markStart) return;
      ev.preventDefault();
      state.markCurrent = eventToCanvasPoint(ev);
    });
    dom.canvas.addEventListener("pointerup", (ev) => {
      if (!state.markingMode || !state.markStart) return;
      ev.preventDefault();
      const end = eventToCanvasPoint(ev);
      const rect = normalizeRect({ x: state.markStart.x, y: state.markStart.y, w: end.x - state.markStart.x, h: end.y - state.markStart.y });
      if (rect.w > 20 && rect.h > 10) {
        if (state.markingMode === "patch") {
          state.patchCandidate = rect;
          setMainState("PARCHE MARCADO", "ok");
          state.flow = "master";
        } else if (state.markingMode === "text") {
          state.textCandidate = rect;
          setMainState("TEXTO MARCADO", "ok");
          state.flow = "master";
        }
      }
      state.markingMode = null;
      state.markStart = null;
      state.markCurrent = null;
      document.body.classList.remove("marking");
      updateUi();
    });
  }

  function eventToCanvasPoint(ev) {
    const r = dom.canvas.getBoundingClientRect();
    return {
      x: clamp((ev.clientX - r.left) * (dom.canvas.width / r.width), 0, dom.canvas.width),
      y: clamp((ev.clientY - r.top) * (dom.canvas.height / r.height), 0, dom.canvas.height),
    };
  }

  function startMarking(mode) {
    if (!state.cameraRunning) return;
    state.markingMode = mode;
    state.markStart = null;
    state.markCurrent = null;
    document.body.classList.add("marking");
    setMainState(mode === "patch" ? "DIBUJA EL PARCHE" : "DIBUJA EL TEXTO", "warn");
    dom.operatorInstruction.textContent = mode === "patch"
      ? "Con el dedo, arrastra un rectángulo alrededor de TODO el parche bueno."
      : "Con el dedo, arrastra un rectángulo SOLO sobre las letras. No incluyas borde ni sombras.";
    dom.nextAction.textContent = dom.operatorInstruction.textContent;
  }

  function saveMaster() {
    if (!state.patchCandidate || !state.textCandidate) {
      setMainState("FALTA MARCAR", "bad");
      dom.reasonText.textContent = "Primero marca el parche bueno y luego el texto bueno.";
      return;
    }
    if (!rectInside(state.textCandidate, state.patchCandidate)) {
      setMainState("TEXTO FUERA", "bad");
      dom.reasonText.textContent = "El texto debe quedar dentro del rectángulo del parche.";
      return;
    }

    const patchPct = rectToPct(state.patchCandidate);
    const textPct = rectToPct(state.textCandidate);
    const templateDataUrl = cropToDataUrl(state.textCandidate);

    state.master = {
      patchPct,
      textPct,
      templateDataUrl,
      createdAt: new Date().toISOString(),
      width: dom.canvas.width,
      height: dom.canvas.height,
      pxPerMm: state.pxPerMm,
      scaleSource: state.scaleSource,
    };
    rebuildTemplateFromMaster();
    saveMasterToStorage();
    state.flow = "inspect";
    state.lastInspection = null;
    state.smoothInspection = null;
    setMainState("MUESTRA GUARDADA", "ok");
    updateUi();
  }

  function startInspect() {
    if (!state.master) return;
    state.flow = "inspect";
    state.markingMode = null;
    state.smoothInspection = null;
    setMainState("INSPECCIONANDO", "ok");
    updateUi();
  }

  function toggleFreeze() {
    state.frozen = !state.frozen;
    dom.btnFreeze.textContent = state.frozen ? "Reanudar imagen" : "Pausar imagen";
    setMainState(state.frozen ? "IMAGEN PAUSADA" : (state.master ? "INSPECCIONANDO" : "CREA MUESTRA"), state.frozen ? "warn" : "ok");
  }

  function newMaster() {
    state.flow = state.cameraRunning ? "master" : "camera";
    state.patchCandidate = null;
    state.textCandidate = null;
    state.master = null;
    state.template = null;
    state.lastInspection = null;
    state.smoothInspection = null;
    localStorage.removeItem("inspector_v6_master");
    setMainState(state.cameraRunning ? "CREA MUESTRA" : "SIN CÁMARA", state.cameraRunning ? "warn" : "unstable");
    updateUi();
  }

  function clearMaster() {
    newMaster();
    localStorage.removeItem("inspector_v6_master");
    localStorage.removeItem("inspector_v6_scale");
    state.pxPerMm = null;
    state.scaleSource = "Sin mm";
    updateUi();
  }

  function usePatchAsScale() {
    const patch = state.master ? pctToRect(state.master.patchPct) : state.patchCandidate;
    if (!patch) return;
    const realW = Number(dom.patchRealW.value);
    const realH = Number(dom.patchRealH.value);
    if (realW <= 0 || realH <= 0) return;
    state.pxPerMm = ((patch.w / realW) + (patch.h / realH)) / 2;
    state.scaleSource = `Parche ${realW.toFixed(1)}×${realH.toFixed(1)} mm`;
    saveScaleToStorage();
    if (state.master) {
      state.master.pxPerMm = state.pxPerMm;
      state.master.scaleSource = state.scaleSource;
      saveMasterToStorage();
    }
    setMainState("ESCALA GUARDADA", "ok");
    updateUi();
  }

  function calibrateWithCard() {
    if (!state.cvReady || !state.cameraRunning) return;
    const sidePx = detectBlackCardSidePx();
    if (!sidePx) {
      setMainState("NO LEE TARJETA", "bad");
      dom.reasonText.textContent = "No se encontró claramente el cuadro negro 5×5. Usa papel mate, más contraste o calibra con tamaño del parche.";
      return;
    }
    state.pxPerMm = sidePx / 50;
    state.scaleSource = "Tarjeta 7×7 / negro 5×5";
    saveScaleToStorage();
    setMainState("TARJETA CALIBRADA", "ok");
    updateUi();
  }

  function inspectCurrentFrame() {
    if (!state.master || !state.template || !state.cvReady) return null;
    const patchRect = pctToRect(state.master.patchPct);
    const expectedText = pctToRect(state.master.textPct);
    const marginX = patchRect.w * 0.20;
    const marginY = patchRect.h * 0.26;
    const search = clipRect({
      x: expectedText.x - marginX,
      y: expectedText.y - marginY,
      w: expectedText.w + marginX * 2,
      h: expectedText.h + marginY * 2,
    }, patchRect);

    const match = matchTextTemplate(search);
    if (!match) {
      return buildInspection({
        patchRect,
        expectedText,
        foundText: null,
        rawConfidence: 0,
        visualMatch: 0,
        reason: "No pude encontrar el texto con seguridad. Revisa luz, enfoque o vuelve a marcar la muestra.",
      });
    }

    const foundText = {
      x: search.x + match.x,
      y: search.y + match.y,
      w: state.template.w,
      h: state.template.h,
    };
    const visualMatch = clamp(match.score * 100, 0, 100);
    return buildInspection({
      patchRect,
      expectedText,
      foundText,
      rawConfidence: visualMatch,
      visualMatch,
      reason: "Lectura comparada contra la muestra maestra.",
    });
  }

  function buildInspection({ patchRect, expectedText, foundText, rawConfidence, visualMatch, reason }) {
    const t = tolerances();
    let dxPx = 0;
    let dyPx = 0;
    let dxPct = 0;
    let dyPct = 0;
    let quality = 0;
    let verdict = "NO LEE";
    let verdictClass = "warn";
    let finalReason = reason;

    if (foundText) {
      const expectedCx = expectedText.x + expectedText.w / 2;
      const expectedCy = expectedText.y + expectedText.h / 2;
      const foundCx = foundText.x + foundText.w / 2;
      const foundCy = foundText.y + foundText.h / 2;
      dxPx = foundCx - expectedCx;
      dyPx = foundCy - expectedCy;
      dxPct = (dxPx / patchRect.w) * 100;
      dyPct = (dyPx / patchRect.h) * 100;
      const xScore = scoreDistance(Math.abs(dxPct), t.xPct);
      const yScore = scoreDistance(Math.abs(dyPct), t.yPct);
      const visualScore = clamp((visualMatch - 45) / 55 * 100, 0, 100);
      quality = clamp(xScore * 0.42 + yScore * 0.42 + visualScore * 0.16, 0, 100);

      if (visualMatch < t.confMin) {
        verdict = visualMatch < 55 ? "NO LEE" : "REVISAR";
        verdictClass = "warn";
        finalReason = "El texto no se encontró con suficiente seguridad. No rechaces la pieza solo con esta lectura.";
      } else if (quality >= t.scoreMin) {
        verdict = "OK";
        verdictClass = "ok";
        finalReason = "El texto coincide con la muestra buena dentro de la tolerancia.";
      } else {
        verdict = "MAL";
        verdictClass = "bad";
        finalReason = "El texto se aleja de la posición guardada en la muestra buena.";
      }
    }

    return {
      ts: Date.now(),
      patchRect,
      expectedText,
      foundText,
      dxPx,
      dyPx,
      dxPct,
      dyPct,
      dxHuman: movementText(dxPx, dxPct, patchRect.w, "x"),
      dyHuman: movementText(dyPx, dyPct, patchRect.h, "y"),
      quality,
      readConfidence: visualMatch,
      visualMatch,
      verdict,
      verdictClass,
      reason: finalReason,
      scale: state.pxPerMm,
      scaleSource: state.scaleSource,
    };
  }

  function scoreDistance(valuePct, tolerancePct) {
    if (valuePct <= tolerancePct) return 100;
    if (valuePct >= tolerancePct * 3) return 0;
    return clamp(100 - ((valuePct - tolerancePct) / (tolerancePct * 2)) * 100, 0, 100);
  }

  function movementText(deltaPx, deltaPct, patchPx, axis) {
    const absPct = Math.abs(deltaPct);
    let amount;
    if (state.pxPerMm) {
      amount = `${Math.abs(deltaPx / state.pxPerMm).toFixed(1)} mm`;
    } else {
      amount = `${absPct.toFixed(1)}%`;
    }
    if (absPct < 0.45) return "Centrado";
    if (axis === "x") return `${amount} ${deltaPx > 0 ? "derecha" : "izquierda"}`;
    return `${amount} ${deltaPx > 0 ? "abajo" : "arriba"}`;
  }

  function smoothInspection(prev, cur) {
    if (!prev) return cur;
    const alpha = 0.26;
    if (!cur.foundText || !prev.foundText) return cur;
    const smoothRect = (a, b) => ({
      x: lerp(a.x, b.x, alpha),
      y: lerp(a.y, b.y, alpha),
      w: lerp(a.w, b.w, alpha),
      h: lerp(a.h, b.h, alpha),
    });
    const mixed = { ...cur };
    mixed.foundText = smoothRect(prev.foundText, cur.foundText);
    mixed.dxPx = lerp(prev.dxPx, cur.dxPx, alpha);
    mixed.dyPx = lerp(prev.dyPx, cur.dyPx, alpha);
    mixed.dxPct = lerp(prev.dxPct, cur.dxPct, alpha);
    mixed.dyPct = lerp(prev.dyPct, cur.dyPct, alpha);
    mixed.quality = lerp(prev.quality, cur.quality, alpha);
    mixed.readConfidence = lerp(prev.readConfidence, cur.readConfidence, alpha);
    mixed.visualMatch = lerp(prev.visualMatch, cur.visualMatch, alpha);
    mixed.dxHuman = movementText(mixed.dxPx, mixed.dxPct, mixed.patchRect.w, "x");
    mixed.dyHuman = movementText(mixed.dyPx, mixed.dyPct, mixed.patchRect.h, "y");
    return mixed;
  }

  function matchTextTemplate(searchRect) {
    let src = null;
    let gray = null;
    let eq = null;
    let edge = null;
    let resultGray = null;
    let resultEdge = null;
    try {
      src = cv.imread(state.rawCanvas);
      const sr = safeCvRect(searchRect, src.cols, src.rows);
      if (sr.width <= state.template.w || sr.height <= state.template.h) return null;
      const roi = src.roi(sr);
      gray = new cv.Mat();
      cv.cvtColor(roi, gray, cv.COLOR_RGBA2GRAY);
      roi.delete();
      eq = new cv.Mat();
      cv.equalizeHist(gray, eq);
      edge = new cv.Mat();
      cv.Canny(eq, edge, 40, 130);

      resultGray = new cv.Mat();
      resultEdge = new cv.Mat();
      cv.matchTemplate(eq, state.template.gray, resultGray, cv.TM_CCOEFF_NORMED);
      cv.matchTemplate(edge, state.template.edge, resultEdge, cv.TM_CCOEFF_NORMED);
      const mmGray = cv.minMaxLoc(resultGray);
      const mmEdge = cv.minMaxLoc(resultEdge);
      const useEdge = mmEdge.maxVal > mmGray.maxVal + 0.04;
      const loc = useEdge ? mmEdge.maxLoc : mmGray.maxLoc;
      const rawScore = useEdge ? mmEdge.maxVal : mmGray.maxVal;
      const blendedScore = clamp((Math.max(mmGray.maxVal, mmEdge.maxVal) * 0.75 + Math.min(mmGray.maxVal, mmEdge.maxVal) * 0.25), 0, 1);
      return { x: loc.x, y: loc.y, score: Math.max(rawScore, blendedScore) };
    } catch (err) {
      console.warn("matchTextTemplate", err);
      return null;
    } finally {
      [src, gray, eq, edge, resultGray, resultEdge].forEach((m) => { if (m) m.delete(); });
    }
  }

  function rebuildTemplateFromMaster() {
    if (!state.master || !state.cvReady) return;
    if (state.template) {
      if (state.template.gray) state.template.gray.delete();
      if (state.template.edge) state.template.edge.delete();
      state.template = null;
    }
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const cctx = c.getContext("2d");
      cctx.drawImage(img, 0, 0);
      let src = null;
      let gray = null;
      let eq = null;
      let edge = null;
      try {
        src = cv.imread(c);
        gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        eq = new cv.Mat();
        cv.equalizeHist(gray, eq);
        edge = new cv.Mat();
        cv.Canny(eq, edge, 40, 130);
        state.template = { gray: eq.clone(), edge: edge.clone(), w: c.width, h: c.height };
        updateUi();
      } catch (err) {
        console.warn("template", err);
      } finally {
        [src, gray, eq, edge].forEach((m) => { if (m) m.delete(); });
      }
    };
    img.src = state.master.templateDataUrl;
  }

  function detectBlackCardSidePx() {
    let src = null;
    let gray = null;
    let blurred = null;
    let binary = null;
    let contours = null;
    let hierarchy = null;
    try {
      src = cv.imread(state.rawCanvas);
      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
      binary = new cv.Mat();
      cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      let best = null;
      const imageArea = src.cols * src.rows;
      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);
        const area = cv.contourArea(cnt);
        if (area < imageArea * 0.01 || area > imageArea * 0.55) { cnt.delete(); continue; }
        const rr = cv.minAreaRect(cnt);
        const w = rr.size.width;
        const h = rr.size.height;
        const ratio = Math.max(w, h) / Math.max(1, Math.min(w, h));
        if (ratio > 1.18) { cnt.delete(); continue; }
        const side = (w + h) / 2;
        const score = area * (1 / ratio);
        if (!best || score > best.score) best = { side, score };
        cnt.delete();
      }
      return best ? best.side : null;
    } catch (err) {
      console.warn(err);
      return null;
    } finally {
      [src, gray, blurred, binary, hierarchy].forEach((m) => { if (m) m.delete(); });
      if (contours) contours.delete();
    }
  }

  function drawOverlay() {
    const w = dom.canvas.width;
    const h = dom.canvas.height;
    ctx.save();
    ctx.lineWidth = Math.max(2, w / 600);
    ctx.font = `${Math.max(15, w / 55)}px Inter, system-ui, sans-serif`;

    if (state.master) {
      const patch = pctToRect(state.master.patchPct);
      const text = pctToRect(state.master.textPct);
      drawRect(patch, "#1e63ff", "Guía del parche");
      drawRect(text, "#16a34a", "Texto esperado");
    }

    if (state.patchCandidate && !state.master) drawRect(state.patchCandidate, "#1e63ff", "Parche bueno");
    if (state.textCandidate && !state.master) drawRect(state.textCandidate, "#16a34a", "Texto bueno");

    const insp = state.smoothInspection || state.lastInspection;
    if (state.flow === "inspect" && insp && insp.foundText) {
      drawRect(insp.foundText, "#d97706", "Texto encontrado");
      drawCenterLine(insp.expectedText, insp.foundText);
    }

    if (state.markingMode && state.markStart && state.markCurrent) {
      const r = normalizeRect({ x: state.markStart.x, y: state.markStart.y, w: state.markCurrent.x - state.markStart.x, h: state.markCurrent.y - state.markStart.y });
      drawRect(r, state.markingMode === "patch" ? "#1e63ff" : "#16a34a", state.markingMode === "patch" ? "Dibujando parche" : "Dibujando texto");
    }

    if (state.flow === "master" && !state.patchCandidate) drawCenterHelp("Marca el contorno del parche bueno");
    else if (state.flow === "master" && state.patchCandidate && !state.textCandidate) drawCenterHelp("Ahora marca solo el bloque de texto");
    else if (state.flow === "inspect" && state.master) drawTopHelp("Coloca cada parche dentro de la guía azul");

    ctx.restore();
  }

  function drawRect(r, color, label) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, dom.canvas.width / 420);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = color;
    const pad = 8;
    const textW = ctx.measureText(label).width + pad * 2;
    const labelH = 26;
    ctx.fillRect(r.x, Math.max(0, r.y - labelH), textW, labelH);
    ctx.fillStyle = "white";
    ctx.fillText(label, r.x + pad, Math.max(18, r.y - 7));
    ctx.restore();
  }

  function drawCenterLine(a, b) {
    const ac = centerOf(a);
    const bc = centerOf(b);
    ctx.save();
    ctx.strokeStyle = "#d97706";
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(ac.x, ac.y);
    ctx.lineTo(bc.x, bc.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#16a34a";
    ctx.beginPath(); ctx.arc(ac.x, ac.y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#d97706";
    ctx.beginPath(); ctx.arc(bc.x, bc.y, 7, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawCenterHelp(text) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,.86)";
    ctx.strokeStyle = "#c8d8ff";
    const bw = Math.min(dom.canvas.width - 60, 620);
    const bh = 72;
    const x = (dom.canvas.width - bw) / 2;
    const y = (dom.canvas.height - bh) / 2;
    roundRect(ctx, x, y, bw, bh, 18);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#123887";
    ctx.textAlign = "center";
    ctx.font = `${Math.max(18, dom.canvas.width / 52)}px Inter, system-ui, sans-serif`;
    ctx.fillText(text, dom.canvas.width / 2, y + 45);
    ctx.restore();
  }

  function drawTopHelp(text) {
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,.88)";
    ctx.strokeStyle = "#dbe3ef";
    const bw = Math.min(dom.canvas.width - 50, 640);
    const x = (dom.canvas.width - bw) / 2;
    roundRect(ctx, x, 16, bw, 44, 14);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#172033";
    ctx.textAlign = "center";
    ctx.font = `${Math.max(16, dom.canvas.width / 64)}px Inter, system-ui, sans-serif`;
    ctx.fillText(text, dom.canvas.width / 2, 44);
    ctx.restore();
  }

  function renderMeasurements() {
    const insp = state.smoothInspection || state.lastInspection;
    if (state.flow !== "inspect" || !insp) {
      if (!state.master) {
        setVerdict("ESPERA", "wait");
        dom.qualityValue.textContent = "--%";
        dom.readConfidence.textContent = "--%";
        dom.reasonText.textContent = "Primero guarda una muestra buena.";
        dom.dxValue.textContent = "--";
        dom.dyValue.textContent = "--";
        dom.visualMatch.textContent = "--";
        dom.patchSize.textContent = "--";
        dom.textSize.textContent = "--";
      }
      return;
    }

    setVerdict(insp.verdict, insp.verdictClass);
    dom.qualityValue.textContent = `${Math.round(insp.quality)}%`;
    dom.readConfidence.textContent = `${Math.round(insp.readConfidence)}%`;
    dom.reasonText.textContent = insp.reason;
    dom.dxValue.textContent = insp.dxHuman;
    dom.dyValue.textContent = insp.dyHuman;
    dom.visualMatch.textContent = `${Math.round(insp.visualMatch)}%`;
    dom.patchSize.textContent = formatSize(insp.patchRect);
    dom.textSize.textContent = insp.foundText ? formatSize(insp.foundText) : "No leído";
  }

  function updateUi() {
    const hasCamera = state.cameraRunning;
    const hasPatch = Boolean(state.patchCandidate || state.master);
    const hasText = Boolean(state.textCandidate || state.master);
    const hasMaster = Boolean(state.master);

    dom.btnMarkPatch.disabled = !hasCamera || state.flow === "inspect";
    dom.btnMarkText.disabled = !hasCamera || !hasPatch || state.flow === "inspect";
    dom.btnSaveMaster.disabled = !hasCamera || !state.patchCandidate || !state.textCandidate;
    dom.btnStartInspect.disabled = !hasMaster;
    dom.btnUsePatchScale.disabled = !(state.patchCandidate || state.master);
    dom.btnCalibrateCard.disabled = !hasCamera || !state.cvReady;

    setStep(dom.stepCamera, state.flow === "camera", hasCamera);
    setStep(dom.stepMaster, state.flow === "master", hasMaster);
    setStep(dom.stepInspect, state.flow === "inspect", false);

    dom.friendlyPatch.textContent = hasPatch ? "Listo" : "Pendiente";
    dom.friendlyText.textContent = hasText ? "Listo" : "Pendiente";
    dom.friendlyMaster.textContent = hasMaster ? "Guardada" : "Pendiente";
    dom.friendlyScale.textContent = state.pxPerMm ? `${state.scaleSource}` : "Opcional / sin mm";
    dom.lockedScale.textContent = state.pxPerMm ? `${state.pxPerMm.toFixed(2)} px/mm · ${state.scaleSource}` : "Sin mm";

    let instruction = "Toca “Iniciar cámara”. Luego coloca un parche correcto para crear la muestra maestra.";
    let action = "Inicia la cámara del celular.";
    if (state.flow === "master") {
      if (!state.patchCandidate) {
        instruction = "Coloca un parche que calidad considere correcto. Toca “Marcar parche bueno” y dibuja alrededor de todo el parche.";
        action = "Marca primero el rectángulo completo del parche bueno.";
      } else if (!state.textCandidate) {
        instruction = "Ahora toca “Marcar texto bueno” y dibuja solo sobre las letras. No metas el borde.";
        action = "Marca solo el bloque de texto del parche bueno.";
      } else {
        instruction = "Revisa que los rectángulos estén bien. Luego toca “Guardar muestra maestra”.";
        action = "Guarda la muestra maestra para empezar a comparar producción.";
      }
    } else if (state.flow === "inspect") {
      instruction = "Coloca cada parche dentro de la guía azul. El sistema buscará el texto en la zona aprendida y comparará contra la muestra.";
      action = "Coloca el parche de producción dentro de la guía. Mantén el celular fijo.";
    }
    if (state.markingMode) {
      instruction = state.markingMode === "patch" ? "Arrastra con el dedo sobre TODO el parche." : "Arrastra con el dedo SOLO sobre el texto.";
      action = instruction;
    }
    dom.operatorInstruction.textContent = instruction;
    dom.nextAction.textContent = action;
  }

  function setStep(el, active, done) {
    el.classList.toggle("active", active);
    el.classList.toggle("done", done && !active);
  }

  function setMainState(text, cls) {
    dom.mainState.textContent = text;
    dom.statusDot.className = `status-dot ${cls || "unstable"}`;
  }

  function setVerdict(text, cls) {
    dom.verdict.textContent = text;
    dom.verdict.className = `verdict ${cls || "wait"}`;
  }

  function publishTelemetryThrottled() {
    const now = Date.now();
    if (now - state.lastSentAt < 420) return;
    state.lastSentAt = now;
    const insp = state.smoothInspection || state.lastInspection;
    const payload = {
      type: "inspection",
      version: state.version,
      ts: now,
      session: state.session,
      flow: state.flow,
      cameraRunning: state.cameraRunning,
      masterSaved: Boolean(state.master),
      scale: state.pxPerMm,
      scaleSource: state.scaleSource,
      verdict: insp ? insp.verdict : (state.master ? "ESPERA" : "SIN MUESTRA"),
      verdictClass: insp ? insp.verdictClass : "wait",
      quality: insp ? insp.quality : null,
      readConfidence: insp ? insp.readConfidence : null,
      visualMatch: insp ? insp.visualMatch : null,
      reason: insp ? insp.reason : dom.reasonText.textContent,
      dxHuman: insp ? insp.dxHuman : null,
      dyHuman: insp ? insp.dyHuman : null,
      dxPct: insp ? insp.dxPct : null,
      dyPct: insp ? insp.dyPct : null,
      patchRect: insp ? rectToPct(insp.patchRect) : (state.master ? state.master.patchPct : null),
      expectedText: insp ? rectToPct(insp.expectedText) : (state.master ? state.master.textPct : null),
      foundText: insp && insp.foundText ? rectToPct(insp.foundText) : null,
    };
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify(payload));
    }
  }

  function connectWebSocket() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws/${state.session}/capture`;
    try {
      state.ws = new WebSocket(url);
      state.ws.addEventListener("open", () => { state.wsConnected = true; });
      state.ws.addEventListener("close", () => { state.wsConnected = false; setTimeout(connectWebSocket, 1600); });
      state.ws.addEventListener("error", () => { state.wsConnected = false; });
    } catch (err) {
      console.warn(err);
      setTimeout(connectWebSocket, 2000);
    }
  }

  function saveMasterToStorage() {
    if (!state.master) return;
    localStorage.setItem("inspector_v6_master", JSON.stringify(state.master));
  }

  function saveScaleToStorage() {
    localStorage.setItem("inspector_v6_scale", JSON.stringify({ pxPerMm: state.pxPerMm, scaleSource: state.scaleSource }));
  }

  function loadMasterFromStorage() {
    try {
      const scaleRaw = localStorage.getItem("inspector_v6_scale");
      if (scaleRaw) {
        const s = JSON.parse(scaleRaw);
        state.pxPerMm = s.pxPerMm || null;
        state.scaleSource = s.scaleSource || "Sin mm";
      }
      const raw = localStorage.getItem("inspector_v6_master");
      if (!raw) return;
      state.master = JSON.parse(raw);
      if (state.master.pxPerMm) {
        state.pxPerMm = state.master.pxPerMm;
        state.scaleSource = state.master.scaleSource || "Muestra";
      }
      state.flow = "inspect";
    } catch (err) {
      console.warn("No se pudo cargar muestra", err);
    }
  }

  function rectToPct(r) {
    return { x: r.x / dom.canvas.width, y: r.y / dom.canvas.height, w: r.w / dom.canvas.width, h: r.h / dom.canvas.height };
  }

  function pctToRect(p) {
    return { x: p.x * dom.canvas.width, y: p.y * dom.canvas.height, w: p.w * dom.canvas.width, h: p.h * dom.canvas.height };
  }

  function cropToDataUrl(r) {
    const rr = clampRectToCanvas(r);
    const c = document.createElement("canvas");
    c.width = Math.max(8, Math.round(rr.w));
    c.height = Math.max(8, Math.round(rr.h));
    const cctx = c.getContext("2d");
    cctx.drawImage(state.rawCanvas, rr.x, rr.y, rr.w, rr.h, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  }

  function safeCvRect(r, maxW, maxH) {
    const rr = clipRect({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) }, { x: 0, y: 0, w: maxW, h: maxH });
    return new cv.Rect(rr.x, rr.y, Math.max(1, rr.w), Math.max(1, rr.h));
  }

  function formatSize(r) {
    if (!r) return "--";
    if (state.pxPerMm) return `${(r.w / state.pxPerMm).toFixed(1)} × ${(r.h / state.pxPerMm).toFixed(1)} mm`;
    return `${r.w.toFixed(0)} × ${r.h.toFixed(0)} px`;
  }

  function centerOf(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
  function normalizeRect(r) {
    const x = r.w < 0 ? r.x + r.w : r.x;
    const y = r.h < 0 ? r.y + r.h : r.y;
    return clampRectToCanvas({ x, y, w: Math.abs(r.w), h: Math.abs(r.h) });
  }
  function clampRectToCanvas(r) { return clipRect(r, { x: 0, y: 0, w: dom.canvas.width, h: dom.canvas.height }); }
  function clipRect(r, bounds) {
    const x = clamp(r.x, bounds.x, bounds.x + bounds.w);
    const y = clamp(r.y, bounds.y, bounds.y + bounds.h);
    const x2 = clamp(r.x + r.w, bounds.x, bounds.x + bounds.w);
    const y2 = clamp(r.y + r.h, bounds.y, bounds.y + bounds.h);
    return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
  }
  function rectInside(inner, outer) {
    return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
  }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }
})();
