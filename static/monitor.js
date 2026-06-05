(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const els = {
    sessionInput: $('sessionInput'), btnConnect: $('btnConnect'), monitorStatus: $('monitorStatus'),
    resultTitle: $('resultTitle'), resultMessage: $('resultMessage'), mScene: $('mScene'), mPatch: $('mPatch'),
    mText: $('mText'), mStable: $('mStable'), mDeltaX: $('mDeltaX'), mDeltaY: $('mDeltaY'), mMode: $('mMode'),
    mTime: $('mTime'), diagram: $('diagram'), history: $('history')
  };
  const ctx = els.diagram.getContext('2d');
  let ws = null;
  let history = [];

  const saved = localStorage.getItem('inspector_v9_monitor_session') || '';
  els.sessionInput.value = saved;

  els.btnConnect.addEventListener('click', connect);
  els.sessionInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
  if (saved.length >= 6) setTimeout(connect, 300);

  function connect() {
    const code = els.sessionInput.value.trim().toUpperCase();
    if (!code) return;
    localStorage.setItem('inspector_v9_monitor_session', code);
    try { if (ws) ws.close(); } catch {}
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws/monitor/${code}`);
    setResult('CONECTANDO', `Buscando sesión ${code}.`, 'state-confirm');
    ws.onopen = () => {
      setResult('CONECTADO', `Monitor conectado a ${code}. Esperando lectura del celular.`, 'state-confirm');
      keepAlive();
    };
    ws.onmessage = (ev) => {
      try { handle(JSON.parse(ev.data)); } catch { /* ignore */ }
    };
    ws.onclose = () => setResult('SIN CONEXIÓN', 'Se perdió conexión con la sesión. Vuelve a conectar.', 'state-error');
  }

  function keepAlive() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify({ type: 'ping', at: Date.now() })); } catch {}
    setTimeout(keepAlive, 15000);
  }

  function handle(data) {
    if (data.type === 'system') {
      if (data.message === 'captura_conectada') setResult('CAPTURA CONECTADA', 'El celular está enviando datos.', 'state-confirm');
      if (data.message === 'captura_desconectada') setResult('CAPTURA DESCONECTADA', 'El celular dejó de enviar datos.', 'state-error');
      return;
    }
    if (data.type !== 'telemetry') return;
    setResult(data.title || data.result || 'LECTURA', data.message || '', classFor(data.result));
    els.mScene.textContent = pct(data.sceneScore);
    els.mPatch.textContent = pct(data.patchScore);
    els.mText.textContent = pct(data.textScore);
    els.mStable.textContent = pct(data.stableScore);
    els.mDeltaX.textContent = directionX(data.dx);
    els.mDeltaY.textContent = directionY(data.dy);
    els.mMode.textContent = modeName(data.mode);
    els.mTime.textContent = data.timestamp || new Date().toLocaleTimeString();
    drawDiagram(data);
    pushHistory(data);
  }

  function setResult(title, message, cls) {
    els.resultTitle.textContent = title;
    els.resultMessage.textContent = message;
    els.monitorStatus.className = `monitor-status ${cls || ''}`;
  }

  function classFor(result) {
    if (result === 'OK' || result === 'MUESTRA_LISTA') return 'state-ok';
    if (result === 'REVISAR') return 'state-review';
    if (result === 'NO_LEE' || result === 'AJUSTAR_ESCENA' || result === 'NO_VEO_PARCHE') return 'state-no-read';
    if (result === 'SIN_CÁMARA') return 'state-error';
    return 'state-confirm';
  }

  function drawDiagram(data) {
    const w = els.diagram.width, h = els.diagram.height;
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(0,0,w,h);
    ctx.strokeStyle = '#d9e0ec'; ctx.lineWidth = 2; ctx.strokeRect(1,1,w-2,h-2);
    const pad = 42;
    const draw = (r, color, label, dashed=false) => {
      if (!r) return;
      const x = pad + r.x * (w - pad*2);
      const y = pad + r.y * (h - pad*2);
      const rw = r.w * (w - pad*2);
      const rh = r.h * (h - pad*2);
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = 4;
      if (dashed) ctx.setLineDash([10,7]);
      ctx.strokeRect(x,y,rw,rh);
      ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
      ctx.fillText(label, x+4, Math.max(20, y-8));
      ctx.restore();
    };
    draw(data.patchRect, '#2563eb', 'Parche');
    draw(data.expectedTextRect, '#94a3b8', 'Esperado', true);
    draw(data.textRect, '#f97316', 'Leído');
    if (data.expectedTextRect && data.textRect) {
      const ex = pad + (data.expectedTextRect.x + data.expectedTextRect.w/2) * (w - pad*2);
      const ey = pad + (data.expectedTextRect.y + data.expectedTextRect.h/2) * (h - pad*2);
      const tx = pad + (data.textRect.x + data.textRect.w/2) * (w - pad*2);
      const ty = pad + (data.textRect.y + data.textRect.h/2) * (h - pad*2);
      ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.fillStyle = '#7c3aed'; ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI*2); ctx.fill();
    }
  }

  function pushHistory(data) {
    if (!['OK','REVISAR','NO_LEE','NO_VEO_PARCHE','AJUSTAR_ESCENA'].includes(data.result)) return;
    history.unshift(data);
    history = history.slice(0, 20);
    els.history.innerHTML = history.map(item => `
      <div class="history-item">
        <div>${escapeHtml(item.title || item.result)}<small>${escapeHtml(item.message || '')}</small></div>
        <div><small>${escapeHtml(item.timestamp || '')}</small>${escapeHtml(directionY(item.dy))}</div>
      </div>`).join('');
  }

  function pct(v) { return Number.isFinite(v) ? `${Math.round(v)}%` : '--'; }
  function directionX(v) { if (v == null) return '--'; if (Math.abs(v) < .6) return 'centrado'; return `${Math.abs(v).toFixed(1)}% ${v > 0 ? 'derecha' : 'izquierda'}`; }
  function directionY(v) { if (v == null) return '--'; if (Math.abs(v) < .6) return 'altura correcta'; return `${Math.abs(v).toFixed(1)}% ${v > 0 ? 'abajo' : 'arriba'}`; }
  function modeName(m) { return ({ SETUP:'preparación', SAMPLE_READY:'muestra', MASTER_SAVED:'muestra guardada', INSPECT:'inspección' }[m] || m || '--'); }
  function escapeHtml(str) { return String(str).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
})();
