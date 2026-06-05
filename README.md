# Inspector Industrial de Parches Bordados V2

Webapp industrial para inspección visual en tiempo real desde smartphone, con monitor PC por WebSocket.

## Qué cambia en V2

- Flujo visible de calibración.
- Botón **Calibrar 7×7**.
- Escala bloqueada en px/mm.
- Medición del parche en milímetros.
- Medición del texto respecto al centro del parche.
- Distancias texto-borde: izquierda, derecha, superior e inferior.
- Monitor PC con esquema geométrico, sin enviar video al servidor.
- Ruta `HEAD /` corregida para evitar el 405 de Render.
- `runtime.txt` para fijar Python 3.12.8.

## Flujo de uso

1. Abrir en celular:

```txt
https://TU-APP.onrender.com/captura
```

2. Presionar **Iniciar cámara**.
3. Colocar la tarjeta física:
   - exterior blanco 7×7 cm,
   - interior negro 5×5 cm.
4. Esperar que detecte el patrón.
5. Presionar **Calibrar 7×7**.
6. Colocar el parche dentro de la guía.
7. Abrir en PC:

```txt
https://TU-APP.onrender.com/monitor
```

8. Escribir el código de sesión del celular, por ejemplo `ABC123`.

## Arquitectura

```txt
Smartphone
  ├─ Cámara getUserMedia
  ├─ OpenCV.js cliente
  ├─ Calibración px/mm
  ├─ Medición parche/texto
  └─ WebSocket métricas JSON

Render / FastAPI
  ├─ Sirve páginas HTML/JS/CSS
  └─ Retransmite telemetría a monitor PC

PC Monitor
  ├─ WebSocket recibe JSON
  └─ Dibuja dashboard geométrico
```

## Render

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

## Estructura

```txt
main.py
requirements.txt
runtime.txt
render.yaml
README.md
static/
  captura.html
  monitor.html
  styles.css
  app.js
  monitor.js
```

## Nota operativa

Si se mueve el celular, cambia la distancia o cambia mucho la iluminación, recalibra. La tarjeta no es adorno: es la regla física del sistema.
