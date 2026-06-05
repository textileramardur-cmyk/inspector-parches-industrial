(() => {
  const $ = (id) => document.getElementById(id);

  const dom = {
    input: $("sessionInput"),
    btn: $("btnConnect"),
    connection: $("monitorConnection"),
    verdict: $("monitorVerdict"),
    score: $("monitorScore"),
    reason: $("monitorReason"),
    canvas: $("schemaCanvas"),
    dx: $("mDx"),
    dy: $("mDy"),
    angle: $("mAngle"),
    patch: $("mPatch"),
    text: $("mText"),
    left: $("mLeft"),
    right: $("mRight"),
    top: $("mTop"),
    bottom: $("mBottom"),
    log: $("readingLog"),
  };

  const ctx = dom.canvas.getContext("2d");
  const state = { ws: null, session: null, last: null, log: [] };

  drawEmpty();

  dom.btn.addEventListener("click", connect);
  dom.input.addEventListener("input", () => {
    dom.input.value = dom.input.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });
  dom.input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") connect();
  });

  function connect() {
    const code = dom.input.value.trim().toUpperCase();
    if (!/^[A-Z]{3}\d{3}$/.test(code)) {
      setConnection("Código inválido", false);
      return;
    }

    if (state.ws) {
      try { state.ws.close(); } catch (_) {}
    }

    state.session = code;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws/${code}/monitor`;
    state.ws = new WebSocket(url);

    setConnection(`Conectando ${code}…`, false);

    state.ws.onopen = () => {
      setConnection(`Conectado a ${code}`, true);
      state.ws.send("last");
    };
    state.ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "inspection") update(payload);
      } catch (err) {
        console.error(err);
      }
    };
    state.ws.onclose = () => setConnection("Desconectado", false);
    state.ws.onerror = () => setConnection("Error de conexión", false);
  }

  function update(payload) {
    state.last = payload;
    updateVerdict(payload);
    updateMetrics(payload);
    drawSchema(payload);
    addLog(payload);
  }

  function updateVerdict(payload) {
    dom.verdict.textContent = payload.verdict || "SIN DATOS";
    dom.verdict.className = "monitor-verdict " + verdictClass(payload.verdict);
    dom.score.textContent = Number.isFinite(payload.score) ? `${payload.score}%` : "--";
    dom.reason.textContent = payload.reason || "Esperando lectura del celular.";
  }

  function updateMetrics(payload) {
    const m = payload.measurements;
    const a = payload.comparison || (m && m.alignment ? m.alignment : null);
    dom.dx.textContent = a ? friendlyOffsetX(a.offsetXmm, Boolean(payload.comparison)) : "--";
    dom.dy.textContent = a ? friendlyOffsetY(a.offsetYmm, Boolean(payload.comparison)) : "--";
    dom.angle.textContent = a ? `${a.angleDeg.toFixed(1)}°` : "--";
    dom.left.textContent = a ? fmtMm(a.edges.left) : "--";
    dom.right.textContent = a ? fmtMm(a.edges.right) : "--";
    dom.top.textContent = a ? fmtMm(a.edges.top) : "--";
    dom.bottom.textContent = a ? fmtMm(a.edges.bottom) : "--";

    if (m && m.patch) dom.patch.textContent = `${m.patch.widthMm.toFixed(1)} × ${m.patch.heightMm.toFixed(1)} mm`;
    else dom.patch.textContent = "--";

    if (m && m.text) dom.text.textContent = `${m.text.widthMm.toFixed(1)} × ${m.text.heightMm.toFixed(1)} mm`;
    else dom.text.textContent = "--";
  }

  function drawSchema(payload) {
    const w = dom.canvas.width;
    const h = dom.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fbfdff";
    ctx.fillRect(0, 0, w, h);

    const m = payload.measurements;
    if (!m || !m.patch) {
      drawCenteredText(payload.reason || "Esperando medición del celular…", "#687789");
      return;
    }

    const patch = m.patch;
    const text = m.text;
    const scale = Math.min((w * 0.62) / Math.max(patch.widthMm, 1), (h * 0.62) / Math.max(patch.heightMm, 1));
    const cx = w / 2;
    const cy = h / 2;
    const pw = patch.widthMm * scale;
    const ph = patch.heightMm * scale;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(degToRad(patch.angleDeg || 0));

    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = payload.verdict === "OK" ? "#12805c" : payload.verdict === "MAL" ? "#c53030" : "#718096";
    ctx.lineWidth = 5;
    roundRect(ctx, -pw / 2, -ph / 2, pw, ph, 14);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(11,95,255,0.45)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 7]);
    ctx.beginPath();
    ctx.moveTo(-pw / 2, 0);
    ctx.lineTo(pw / 2, 0);
    ctx.moveTo(0, -ph / 2);
    ctx.lineTo(0, ph / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (text && m.alignment) {
      const tx = m.alignment.offsetXmm * scale;
      const ty = m.alignment.offsetYmm * scale;
      const tw = Math.max(10, text.widthMm * scale);
      const th = Math.max(8, text.heightMm * scale);
      const relAngle = degToRad(m.alignment.angleDeg || 0);

      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(relAngle);
      ctx.fillStyle = "rgba(183,121,31,0.14)";
      ctx.strokeStyle = "#b7791f";
      ctx.lineWidth = 3;
      roundRect(ctx, -tw / 2, -th / 2, tw, th, 9);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.strokeStyle = "#34495e";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }

    ctx.restore();
    drawLegend(payload);
  }

  function drawLegend(payload) {
    const m = payload.measurements;
    const a = m && m.alignment ? m.alignment : null;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.strokeStyle = "#d9e2ec";
    roundRect(ctx, 18, 18, 360, 128, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#102033";
    ctx.font = "800 17px system-ui";
    ctx.fillText((payload.reason || "Medición").substring(0, 42), 34, 48);
    ctx.font = "700 14px system-ui";
    ctx.fillStyle = "#687789";
    ctx.fillText(`Parche: ${m.patch.widthMm.toFixed(1)} × ${m.patch.heightMm.toFixed(1)} mm`, 34, 75);
    if (a) {
      ctx.fillText(`Horizontal: ${friendlyOffsetX(a.offsetXmm)}`, 34, 98);
      ctx.fillText(`Vertical: ${friendlyOffsetY(a.offsetYmm)} · Inclinación: ${a.angleDeg.toFixed(1)}°`, 34, 121);
    }
    ctx.restore();
  }

  function drawEmpty() {
    ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
    ctx.fillStyle = "#fbfdff";
    ctx.fillRect(0, 0, dom.canvas.width, dom.canvas.height);
    drawCenteredText("Introduce el código del celular para recibir medición", "#687789");
  }

  function drawCenteredText(text, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = "800 22px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(text, dom.canvas.width / 2, dom.canvas.height / 2);
    ctx.restore();
  }

  function addLog(payload) {
    const m = payload.measurements;
    const a = payload.comparison || (m && m.alignment ? m.alignment : null);
    const row = {
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      verdict: payload.verdict,
      score: Number.isFinite(payload.score) ? `${payload.score}%` : "--",
      center: a ? `${friendlyOffsetX(a.offsetXmm, Boolean(payload.comparison))} / ${friendlyOffsetY(a.offsetYmm, Boolean(payload.comparison))}` : "--",
    };
    state.log.unshift(row);
    state.log = state.log.slice(0, 12);
    dom.log.innerHTML = state.log.map((r) => `
      <div class="log-row">
        <span>${r.time}</span>
        <strong class="${verdictClass(r.verdict)}">${r.verdict}</strong>
        <span>${r.score}</span>
        <span>${r.center}</span>
      </div>
    `).join("");
  }

  function setConnection(text, connected) {
    dom.connection.textContent = text;
    dom.connection.className = "connection-chip" + (connected ? " connected" : "");
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function friendlyOffsetX(mm, compared) {
    if (!Number.isFinite(mm)) return "--";
    if (Math.abs(mm) < 0.15) return compared ? "Igual que muestra" : "Centrado";
    return `${Math.abs(mm).toFixed(1)} mm ${mm > 0 ? "derecha" : "izquierda"}`;
  }
  function friendlyOffsetY(mm, compared) {
    if (!Number.isFinite(mm)) return "--";
    if (Math.abs(mm) < 0.15) return compared ? "Igual que muestra" : "Centrado";
    return `${Math.abs(mm).toFixed(1)} mm ${mm > 0 ? "abajo" : "arriba"}`;
  }
  function fmtMm(v) { return Number.isFinite(v) ? `${v.toFixed(1)} mm` : "--"; }
  function verdictClass(v) {
    if (v === "OK") return "ok";
    if (v === "MAL") return "bad";
    if (v === "REVISAR") return "revisar";
    if (v === "NO LEE") return "nolee";
    if (v === "MUESTRA") return "muestra";
    return "unstable";
  }
  function degToRad(deg) { return deg * Math.PI / 180; }
})();
