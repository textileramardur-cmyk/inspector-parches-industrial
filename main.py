from __future__ import annotations

import asyncio
import json
import random
import re
import string
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
SESSION_RE = re.compile(r"^[A-Z]{3}[0-9]{3}$")

app = FastAPI(title="Inspector Industrial de Parches", version="1.0.0")

# En producción normal se sirve todo desde el mismo dominio de Render.
# CORS abierto deja margen para probar captura desde GitHub Pages contra backend Render.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@dataclass
class SessionState:
    code: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    capture: WebSocket | None = None
    monitors: set[WebSocket] = field(default_factory=set)
    last_payload: dict[str, Any] | None = None


sessions: dict[str, SessionState] = {}
sessions_lock = asyncio.Lock()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_code(code: str) -> str:
    return code.strip().upper()


def make_code() -> str:
    letters = "".join(random.choices(string.ascii_uppercase, k=3))
    digits = "".join(random.choices(string.digits, k=3))
    return f"{letters}{digits}"


async def get_or_create_session(code: str | None = None) -> SessionState:
    async with sessions_lock:
        if code:
            code = normalize_code(code)
            if not SESSION_RE.match(code):
                raise ValueError("El código debe tener formato ABC123.")
            state = sessions.get(code)
            if not state:
                state = SessionState(code=code)
                sessions[code] = state
            return state

        for _ in range(100):
            new_code = make_code()
            if new_code not in sessions:
                state = SessionState(code=new_code)
                sessions[new_code] = state
                return state
        raise RuntimeError("No se pudo crear una sesión única.")


async def safe_send(ws: WebSocket, payload: dict[str, Any]) -> bool:
    try:
        await ws.send_text(json.dumps(payload, ensure_ascii=False))
        return True
    except Exception:
        return False


async def broadcast_to_monitors(state: SessionState, payload: dict[str, Any]) -> None:
    if not state.monitors:
        return
    dead: list[WebSocket] = []
    for monitor in list(state.monitors):
        ok = await safe_send(monitor, payload)
        if not ok:
            dead.append(monitor)
    for ws in dead:
        state.monitors.discard(ws)


@app.get("/")
async def root() -> RedirectResponse:
    return RedirectResponse("/captura")


@app.get("/captura")
async def captura_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "captura.html")


@app.get("/monitor")
async def monitor_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "monitor.html")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "time": utc_now_iso(),
        "active_sessions": len(sessions),
    }


@app.post("/api/session")
async def create_session() -> dict[str, str]:
    state = await get_or_create_session()
    return {"code": state.code}


@app.get("/api/session/{code}")
async def read_session(code: str) -> JSONResponse:
    try:
        state = await get_or_create_session(code)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)

    return JSONResponse(
        {
            "ok": True,
            "code": state.code,
            "has_capture": state.capture is not None,
            "monitors": len(state.monitors),
            "last_payload": state.last_payload,
        }
    )


@app.websocket("/ws/capture/{code}")
async def ws_capture(websocket: WebSocket, code: str) -> None:
    await websocket.accept()
    try:
        state = await get_or_create_session(code)
    except ValueError as exc:
        await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))
        await websocket.close(code=1008)
        return

    # Solo una captura activa por sesión. La nueva reemplaza a la anterior.
    old_capture = state.capture
    state.capture = websocket
    if old_capture and old_capture is not websocket:
        try:
            await old_capture.close(code=1012)
        except Exception:
            pass

    await safe_send(websocket, {"type": "session", "code": state.code, "server_time": utc_now_iso()})
    await broadcast_to_monitors(
        state,
        {
            "type": "capture_connected",
            "code": state.code,
            "server_time": utc_now_iso(),
        },
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                continue

            payload.setdefault("type", "metrics")
            payload["code"] = state.code
            payload["server_time"] = utc_now_iso()
            state.last_payload = payload
            await broadcast_to_monitors(state, payload)
    except WebSocketDisconnect:
        pass
    finally:
        if state.capture is websocket:
            state.capture = None
        await broadcast_to_monitors(
            state,
            {
                "type": "capture_disconnected",
                "code": state.code,
                "server_time": utc_now_iso(),
            },
        )


@app.websocket("/ws/monitor/{code}")
async def ws_monitor(websocket: WebSocket, code: str) -> None:
    await websocket.accept()
    try:
        state = await get_or_create_session(code)
    except ValueError as exc:
        await websocket.send_text(json.dumps({"type": "error", "message": str(exc)}))
        await websocket.close(code=1008)
        return

    state.monitors.add(websocket)
    await safe_send(
        websocket,
        {
            "type": "session",
            "code": state.code,
            "has_capture": state.capture is not None,
            "last_payload": state.last_payload,
            "server_time": utc_now_iso(),
        },
    )

    try:
        # Mantiene el socket vivo y acepta pings del monitor.
        while True:
            raw = await websocket.receive_text()
            if raw.strip().lower() == "ping":
                await safe_send(websocket, {"type": "pong", "server_time": utc_now_iso()})
    except WebSocketDisconnect:
        pass
    finally:
        state.monitors.discard(websocket)
