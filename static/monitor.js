(() => {
  const $ = (id) => document.getElementById(id);
  const dom = {
    form: $("connectForm"),
    input: $("sessionInput"),
    verdict: $("monitorVerdict"),
    reason: $("monitorReason"),
    quality: $("monitorQuality"),
    confidence: $("monitorConfidence"),
    dx: $("monitorDx"),
    dy: $("monitorDy"),
    visual: $("monitorVisual"),
    session: $("monitorSession"),
    flow: $("monitorFlow"),
    master: $("monitorMaster"),
    scale: $("monitorScale"),
    last: $("monitorLast"),
    canvas: $("diagramCanvas"),
  };
  const ctx = dom.canvas.getContext("2d");
  let ws = null;
  let currentSession = null;
  let lastPayload = null;

  dom.form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const code = dom.input.value.trim().toUpperCase();
    if (!/^[A-Z]{3}\d{3}$/.test(code)) {
      setReason("Escribe el código de 3 letras y 3 números que aparece en el celular.");
      return;
    }
    connect(code);
  });

  dom.input.addEventListener("input", () => {
    dom.input.value = dom.input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });

  drawEmptyDiagram();

  function connect(session) {
    currentSession = session;
    if (ws) ws.close();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws/${session}/monitor`);
    dom.session.textContent = session;
    setReason("Conectando al celular…");
    ws.addEventListener("open", () => {
      setReason("Conectado. Esperando lectura del celular.");
      ws.send("last");
    });
    ws.addEventListener("message", (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        lastPayload = payload;
        render(payload);
      } catch (err) {
        console.warn(err);
      }
    });
    ws.addEventListener("close", () => {
      setReason("Conexión cerrada. Revisa que el celular siga abierto.");
    });
    ws.addEventListener("error", () => {
      setReason("No se pudo conectar. Revisa el código y la red.");
    });
  }

  function render(p) {
    const verdict = p.verdict || "SIN DATOS";
    setVerdict(verdict, p.verdictClass || "wait");
    dom.reason.textContent = p.reason || "Sin observaciones.";
    dom.quality.textContent = numPct(p.quality);
    dom.confidence.textContent = numPct(p.readConfidence);
    dom.dx.textContent = p.dxHuman || "--";
    dom.dy.textContent = p.dyHuman || "--";
    dom.visual.textContent = numPct(p.visualMatch);
    dom.session.textContent = p.session || currentSession || "---";
    dom.flow.textContent = flowLabel(p.flow);
    dom.master.textContent = p.masterSaved ? "Guardada" : "Pendiente";
    dom.scale.textContent = p.scale ? `${Number(p.scale).toFixed(2)} px/mm · ${p.scaleSource || "mm"}` : "Sin mm · comparando por proporción";
    dom.last.textContent = new Date().toLocaleTimeString();
    drawDiagram(p);
  }

  function setVerdict(text, cls) {
    dom.verdict.textContent = text;
    dom.verdict.className = `verdict large ${cls || "wait"}`;
  }

  function setReason(text) {
    dom.reason.textContent = text;
  }

  function numPct(v) {
    return typeof v === "number" && Number.isFinite(v) ? `${Math.round(v)}%` : "--%";
  }

  function flowLabel(flow) {
    return ({ camera: "Cámara", master: "Creando muestra", inspect: "Inspección" }[flow] || "---");
  }

  function drawEmptyDiagram() {
    ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
    ctx.fillStyle = "#f7faff";
    ctx.fillRect(0, 0, dom.canvas.width, dom.canvas.height);
    ctx.fillStyle = "#64748b";
    ctx.font = "22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Sin datos de inspección", dom.canvas.width / 2, dom.canvas.height / 2);
  }

  function drawDiagram(p) {
    const W = dom.canvas.width;
    const H = dom.canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#f7faff";
    ctx.fillRect(0, 0, W, H);

    if (!p.patchRect) {
      drawEmptyDiagram();
      return;
    }

    const patch = fitPctRectToCanvas(p.patchRect, W, H);
    const expected = p.expectedText ? rectRelativeToFit(p.expectedText, p.patchRect, patch) : null;
    const found = p.foundText ? rectRelativeToFit(p.foundText, p.patchRect, patch) : null;

    drawLabelRect(patch, "#1e63ff", "Parche guía");
    if (expected) drawLabelRect(expected, "#16a34a", "Texto esperado");
    if (found) drawLabelRect(found, "#d97706", "Texto encontrado");
    if (expected && found) drawConnector(expected, found);

    ctx.fillStyle = "#172033";
    ctx.font = "18px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`Lateral: ${p.dxHuman || "--"}`, 22, H - 56);
    ctx.fillText(`Vertical: ${p.dyHuman || "--"}`, 22, H - 28);
  }

  function fitPctRectToCanvas(patchPct, W, H) {
    const aspect = patchPct.w / Math.max(0.0001, patchPct.h);
    let w = W * 0.68;
    let h = w / aspect;
    if (h > H * 0.68) { h = H * 0.68; w = h * aspect; }
    return { x: (W - w) / 2, y: 34, w, h };
  }

  function rectRelativeToFit(rectPct, patchPct, fit) {
    const rx = (rectPct.x - patchPct.x) / patchPct.w;
    const ry = (rectPct.y - patchPct.y) / patchPct.h;
    const rw = rectPct.w / patchPct.w;
    const rh = rectPct.h / patchPct.h;
    return { x: fit.x + rx * fit.w, y: fit.y + ry * fit.h, w: rw * fit.w, h: rh * fit.h };
  }

  function drawLabelRect(r, color, label) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = color;
    const labelW = ctx.measureText(label).width + 18;
    ctx.fillRect(r.x, Math.max(0, r.y - 28), Math.max(labelW, 120), 28);
    ctx.fillStyle = "white";
    ctx.font = "15px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, r.x + 8, Math.max(19, r.y - 8));
    ctx.restore();
  }

  function drawConnector(a, b) {
    const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    ctx.save();
    ctx.strokeStyle = "#d97706";
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ac.x, ac.y);
    ctx.lineTo(bc.x, bc.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#16a34a";
    ctx.beginPath(); ctx.arc(ac.x, ac.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#d97706";
    ctx.beginPath(); ctx.arc(bc.x, bc.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
})();
