from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import DefaultDict, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Inspector de Parches Industrial", version="9.0.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# session_code -> monitor sockets
monitors: DefaultDict[str, Set[WebSocket]] = defaultdict(set)
# session_code -> capture sockets
captures: DefaultDict[str, Set[WebSocket]] = defaultdict(set)


@app.get("/")
async def root():
    return RedirectResponse(url="/captura")


@app.head("/")
async def root_head():
    return PlainTextResponse("")


@app.get("/health")
async def health():
    return JSONResponse({"ok": True, "service": "inspector-parches-industrial", "version": "9.0.0"})


@app.get("/captura")
async def captura():
    return FileResponse(STATIC_DIR / "captura.html")


@app.get("/monitor")
async def monitor():
    return FileResponse(STATIC_DIR / "monitor.html")


async def broadcast_to_monitors(session_code: str, message: str):
    stale = []
    for ws in list(monitors[session_code]):
        try:
            await ws.send_text(message)
        except Exception:
            stale.append(ws)
    for ws in stale:
        monitors[session_code].discard(ws)


@app.websocket("/ws/capture/{session_code}")
async def ws_capture(websocket: WebSocket, session_code: str):
    await websocket.accept()
    session_code = session_code.upper().strip()
    captures[session_code].add(websocket)
    await broadcast_to_monitors(session_code, '{"type":"system","message":"captura_conectada"}')
    try:
        while True:
            data = await websocket.receive_text()
            await broadcast_to_monitors(session_code, data)
    except WebSocketDisconnect:
        captures[session_code].discard(websocket)
        await broadcast_to_monitors(session_code, '{"type":"system","message":"captura_desconectada"}')
    except Exception:
        captures[session_code].discard(websocket)
        await broadcast_to_monitors(session_code, '{"type":"system","message":"captura_error"}')


@app.websocket("/ws/monitor/{session_code}")
async def ws_monitor(websocket: WebSocket, session_code: str):
    await websocket.accept()
    session_code = session_code.upper().strip()
    monitors[session_code].add(websocket)
    try:
        await websocket.send_text('{"type":"system","message":"monitor_conectado"}')
        while True:
            # Keep connection alive. We do not need inbound messages, but reading detects disconnect.
            await websocket.receive_text()
    except WebSocketDisconnect:
        monitors[session_code].discard(websocket)
    except Exception:
        monitors[session_code].discard(websocket)
