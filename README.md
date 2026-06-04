# Inspector Industrial de Parches

Webapp industrial para inspección visual en tiempo real de parches bordados sobre prendas de tejido de punto.

## Arquitectura

- El smartphone ejecuta la visión computacional localmente con OpenCV.js.
- Render/FastAPI no recibe video. Solo recibe telemetría geométrica por WebSocket.
- La PC abre `/monitor`, escribe el código de sesión `ABC123` y recibe los datos en vivo.
- La captura móvil abre `/captura`, inicia cámara y envía métricas.

## Estructura

```txt
.
├── main.py
├── requirements.txt
├── render.yaml
├── README.md
└── static
    ├── captura.html
    ├── monitor.html
    ├── styles.css
    ├── app.js
    └── monitor.js
```

## Pipeline de visión

1. `getUserMedia` toma cámara trasera con `playsinline` para móviles.
2. Cada frame se dibuja en canvas.
3. OpenCV.js lee el canvas y convierte a escala de grises.
4. Calibración: detecta el cuadrado negro interior 5×5 cm mediante threshold inverso, contornos, `approxPolyDP`, `minAreaRect`, aspect ratio y fill ratio.
5. Escala: `pxPerMm = ladoDetectadoPx / 50 mm`.
6. Parche: Canny + dilatación + cierre morfológico + selección del contorno dominante fuera del patrón de calibración.
7. Texto: ROI interior del parche, Canny + morfología horizontal, unión de bounding boxes y ángulo por momentos centrales.
8. Score: 40% X, 40% Y, 20% ángulo.

## Fórmula de aceptación

```txt
ΔX_mm = (CentroTextoX - CentroParcheX) / pxPerMm
ΔY_mm = (CentroTextoY - CentroParcheY) / pxPerMm
Ángulo = ÁnguloTexto - ÁnguloParche

ScoreX = max(0, 1 - abs(ΔX_mm) / toleranciaX)
ScoreY = max(0, 1 - abs(ΔY_mm) / toleranciaY)
ScoreA = max(0, 1 - abs(Ángulo) / toleranciaAngulo)

Score = (0.40 * ScoreX + 0.40 * ScoreY + 0.20 * ScoreA) * 100
```

Dictamen `OK` cuando:

- `abs(ΔX) <= toleranciaX`
- `abs(ΔY) <= toleranciaY`
- `abs(Ángulo) <= toleranciaAngulo`
- `Score >= scoreMinimo`
- La medición está estable en los últimos frames

## Desarrollo local

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Abrir:

- Captura móvil: `http://localhost:8000/captura`
- Monitor PC: `http://localhost:8000/monitor`

Para cámara en smartphone necesitas HTTPS en producción. Render lo resuelve con dominio HTTPS.

## Render

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

También se incluye `render.yaml` para Blueprint.

## Uso en piso

1. Abrir `/captura` en el teléfono.
2. Presionar `Iniciar cámara`.
3. Abrir `/monitor` en PC.
4. Escribir el código mostrado en el teléfono, por ejemplo `ABC123`.
5. Colocar visible la tarjeta negra 5×5 cm y el parche dentro de la guía.
6. Ajustar tolerancias si el criterio de calidad cambia.

## Notas técnicas

- Fase 1 usa OpenCV.js clásico. La estructura deja libre el camino para ONNX Runtime Web o YOLO cuando exista dataset etiquetado.
- Para una versión de producción seria, conviene fijar iluminación, distancia de cámara, soporte físico y una tarjeta ArUco/AprilTag. Pretender precisión milimétrica con pulso humano es muy romántico, pero la física no suele aplaudir poesía.
