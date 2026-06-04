(() => {
  'use strict';

  const canvas = document.getElementById('geometryCanvas');
  const ctx = canvas.getContext('2d');

  const els = {
    codeInput: document.getElementById('codeInput'),
    connectBtn: document.getElementById('connectBtn'),
    connectionState: document.getElementById('connectionState'),
    monitorStatusCard: document.getElementById('monitorStatusCard'),
    monitorStatus: document.getElementById('monitorStatus'),
    monitorDx: document.getElementById('monitorDx'),
    monitorDy: document.getElementById('monitorDy'),
    monitorAngle: document.getElementById('monitorAngle'),
    monitorScore: document.getElementById('monitorScore'),
    lastUpdate: document.getElementById('lastUpdate'),
    sessionValue: document.getElementById('sessionValue'),
    pxmmValue: document.getElementById('pxmmValue'),
    patchValue: document.getElementById('patchValue'),
    textValue: document.getElementById('textValue'),
    stableValue: document.getElementById('stableValue'),
    messageValue: document.getElementById('messageValue'),
  };

  const state = { ws: null, code: null, lastPayload: null };

  const COLORS = {
    ok: '#138a42',
    bad: '#c62828',
    warn: '#b26a00',
    cyan: '#0f8f88',
    ink: '#0b1f33',
    muted: '#63758a',
    grid: '#d9e3ee',
  };

  function cleanCode(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }

  function wsBaseUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  }

  function connect(code) {
    const clean = cleanCode(code);
    if (!/^[A-Z]{3}[0-9]{3}$/.test(clean)) {
      setConnection('Código inválido. Usa formato ABC123. La burocracia mínima, qué emoción.');
      return;
    }

    if (state.ws) {
      try { state.ws.close(); } catch (_) {}
    }

    state.code = clean;
    els.codeInput.value = clean;
    els.sessionValue.textContent = clean;
    setConnection(`Conectando a sesión ${clean}...`);

    const ws = new WebSocket(`${wsBaseUrl()}/ws/monitor/${clean}`);
    state.ws = ws;

    ws.addEventListener('open', () => setConnection(`Monitor vinculado a ${clean}. Esperando telemetría del teléfono.`));
    ws.addEventListener('close', () => setConnection('Monitor desconectado.'));
    ws.addEventListener('error', () => setConnection('Error de conexión WebSocket.'));
    ws.addEventListener('message', (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        handlePayload(payload);
      } catch (_) {}
    });
  }

  function handlePayload(payload) {
    if (payload.type === 'session') {
      if (payload.last_payload) handlePayload(payload.last_payload);
      setConnection(payload.has_capture ? `Sesión ${payload.code} activa.` : `Sesión ${payload.code} sin captura móvil todavía.`);
      return;
    }
    if (payload.type === 'capture_connected') {
      setConnection(`Captura móvil conectada en ${payload.code}.`);
      return;
    }
    if (payload.type === 'capture_disconnected') {
      setConnection(`Captura móvil desconectada en ${payload.code}.`);
      return;
    }
    if (payload.type !== 'metrics') return;

    state.lastPayload = payload;
    updateKpis(payload);
    drawGeometry(payload);
  }

  function updateKpis(p) {
    const m = p.metrics;
    const status = p.status || 'INESTABLE';
    els.monitorStatus.textContent = status;
    els.monitorStatusCard.className = `kpi status ${statusClass(status)}`;
    els.monitorDx.textContent = m ? `${m.dxMm.toFixed(1)} mm` : '-- mm';
    els.monitorDy.textContent = m ? `${m.dyMm.toFixed(1)} mm` : '-- mm';
    els.monitorAngle.textContent = m ? `${m.angleDeg.toFixed(1)}°` : '--°';
    els.monitorScore.textContent = m ? `${Math.round(m.score)}%` : '--%';
    els.lastUpdate.textContent = p.server_time ? new Date(p.server_time).toLocaleTimeString() : new Date().toLocaleTimeString();
    els.sessionValue.textContent = p.code || state.code || '---';
    els.pxmmValue.textContent = p.pxPerMm ? `${p.pxPerMm.toFixed(2)} px/mm` : '---';
    els.patchValue.textContent = p.patch ? `${p.patch.size.w.toFixed(0)}×${p.patch.size.h.toFixed(0)} px · ${p.patch.angle.toFixed(1)}°` : '---';
    els.textValue.textContent = p.text ? `${p.text.bbox.w.toFixed(0)}×${p.text.bbox.h.toFixed(0)} px · ${p.text.angle.toFixed(1)}°` : '---';
    els.stableValue.textContent = p.stable ? 'Estable' : 'Inestable';
    els.messageValue.textContent = p.message || '---';
  }

  function drawGeometry(p) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();

    const frame = p.frame || { w: 1280, h: 720 };
    const scale = Math.min(canvas.width / frame.w, canvas.height / frame.h);
    const ox = (canvas.width - frame.w * scale) / 2;
    const oy = (canvas.height - frame.h * scale) / 2;

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 2 / scale;
    ctx.strokeRect(0, 0, frame.w, frame.h);

    if (p.calibration?.rect) drawRotatedRect(p.calibration.rect, COLORS.cyan, 3 / scale, 'CAL 5×5');
    const statusColor = p.status === 'OK' ? COLORS.ok : p.status === 'MAL' ? COLORS.bad : COLORS.warn;
    if (p.patch?.rect) {
      drawRotatedRect(p.patch.rect, statusColor, 4 / scale, 'PARCHE');
      drawCross(p.patch.center, statusColor, 16 / scale);
      drawAxis(p.patch.center, p.patch.angle, 120 / scale, statusColor);
    }
    if (p.text?.bbox) {
      drawBbox(p.text.bbox, COLORS.ink, 3 / scale, 'TEXTO');
      drawCross(p.text.center, COLORS.ink, 14 / scale);
      drawAxis(p.text.center, p.text.angle, 95 / scale, COLORS.ink);
    }
    if (p.patch?.center && p.text?.center) drawDelta(p.patch.center, p.text.center, statusColor, 3 / scale);

    ctx.restore();
    drawSummaryText(p);
  }

  function drawGrid() {
    ctx.save();
    ctx.fillStyle = '#fbfdff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawSummaryText(p) {
    const m = p.metrics;
    ctx.save();
    ctx.fillStyle = p.status === 'OK' ? COLORS.ok : p.status === 'MAL' ? COLORS.bad : COLORS.warn;
    ctx.font = '700 24px Inter, system-ui, sans-serif';
    const label = m ? `${p.status} · X ${m.dxMm.toFixed(1)} mm · Y ${m.dyMm.toFixed(1)} mm · ${m.angleDeg.toFixed(1)}° · ${Math.round(m.score)}%` : `${p.status || 'INESTABLE'} · ${p.message || ''}`;
    ctx.fillText(label, 24, 36);
    ctx.restore();
  }

  function drawRotatedRect(rect, color, lineWidth, label) {
    const pts = rotatedRectPoints(rect);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();
    drawLabel(label, pts[0].x, pts[0].y, color);
    ctx.restore();
  }

  function drawBbox(b, color, lineWidth, label) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    drawLabel(label, b.x, b.y, color);
    ctx.restore();
  }

  function drawCross(p, color, size) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size / 5);
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

  function drawDelta(a, b, color, lineWidth) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawLabel(label, x, y, color) {
    ctx.save();
    ctx.font = '700 14px Inter, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(label, x + 6, y - 6);
    ctx.restore();
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

  function setConnection(message) {
    els.connectionState.textContent = message;
  }

  function statusClass(status) {
    if (status === 'OK') return 'ok';
    if (status === 'MAL') return 'bad';
    return 'warn';
  }

  els.codeInput.addEventListener('input', () => { els.codeInput.value = cleanCode(els.codeInput.value); });
  els.connectBtn.addEventListener('click', () => connect(els.codeInput.value));
  els.codeInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') connect(els.codeInput.value); });
  drawGrid();
})();
