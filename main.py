from __future__ import annotations

import json
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Deque

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="Inspector Industrial de Parches", version="6.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class SessionHub:
    """Retransmisor de telemetría.

    El celular analiza localmente. El servidor solo coordina sesiones y manda
    métricas al monitor de PC. Nada de video al backend, porque tampoco hace
    falta convertir Render en una freidora de frames.
    """

    def __init__(self) -> None:
        self.monitors: dict[str, set[WebSocket]] = defaultdict(set)
        self.captures: dict[str, set[WebSocket]] = defaultdict(set)
        self.last_payload: dict[str, dict] = {}
        self.history: dict[str, Deque[dict]] = defaultdict(lambda: deque(maxlen=100))

    async def connect(self, session: str, role: str, websocket: WebSocket) -> None:
        await websocket.accept()
        bucket = self.monitors if role == "monitor" else self.captures
        bucket[session].add(websocket)
        if role == "monitor" and session in self.last_payload:
            await self.safe_send(websocket, self.last_payload[session])

    def disconnect(self, session: str, role: str, websocket: WebSocket) -> None:
        bucket = self.monitors if role == "monitor" else self.captures
        if websocket in bucket.get(session, set()):
            bucket[session].remove(websocket)
        if session in bucket and not bucket[session]:
            del bucket[session]

    async def safe_send(self, websocket: WebSocket, payload: dict) -> bool:
        try:
            await websocket.send_text(json.dumps(payload, ensure_ascii=False))
            return True
        except Exception:
            return False

    async def publish(self, session: str, payload: dict) -> None:
        payload["server_ts"] = time.time()
        self.last_payload[session] = payload
        self.history[session].append(payload)
        dead: list[WebSocket] = []
        for monitor in list(self.monitors.get(session, set())):
            if not await self.safe_send(monitor, payload):
                dead.append(monitor)
        for ws in dead:
            self.monitors[session].discard(ws)


hub = SessionHub()


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"ok": True, "service": "inspector-parches-industrial", "version": "6.0.0"})


@app.get("/")
def index() -> RedirectResponse:
    return RedirectResponse(url="/captura", status_code=302)


@app.head("/")
def index_head() -> Response:
    return Response(status_code=200)


@app.get("/captura")
def captura() -> FileResponse:
    return FileResponse(STATIC_DIR / "captura.html")


@app.get("/monitor")
def monitor() -> FileResponse:
    return FileResponse(STATIC_DIR / "monitor.html")


@app.websocket("/ws/{session}/{role}")
async def websocket_endpoint(websocket: WebSocket, session: str, role: str) -> None:
    session = session.upper().strip()
    role = role.lower().strip()
    if role not in {"capture", "monitor"}:
        await websocket.close(code=1008)
        return

    await hub.connect(session, role, websocket)
    try:
        while True:
            raw = await websocket.receive_text()
            if role == "capture":
                try:
                    payload = json.loads(raw)
                    payload["session"] = session
                    payload["role"] = "capture"
                    await hub.publish(session, payload)
                except json.JSONDecodeError:
                    await websocket.send_text(json.dumps({"type": "error", "message": "JSON inválido"}, ensure_ascii=False))
            else:
                if raw.strip().lower() in {"ping", "last"} and session in hub.last_payload:
                    await hub.safe_send(websocket, hub.last_payload[session])
    except WebSocketDisconnect:
        hub.disconnect(session, role, websocket)
    except Exception:
        hub.disconnect(session, role, websocket)
        try:
            await websocket.close()
        except Exception:
            pass
