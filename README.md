# Inspector Industrial de Parches V6

Webapp para inspección visual guiada de parches bordados sobre prendas de tejido de punto.

## Cambio clave de V6

La tarjeta 7×7 deja de ser obligatoria en el flujo normal. Ahora el sistema trabaja con una **muestra maestra**:

1. Fijas el celular.
2. Colocas un parche correcto.
3. Marcas el contorno del parche.
4. Marcas el bloque de texto.
5. Guardas la muestra maestra.
6. Inspeccionas producción comparando contra esa muestra.

La tarjeta 7×7 / 5×5 queda como calibración opcional de supervisor para obtener medidas reales en milímetros.

## Rutas

- `/captura`: celular.
- `/monitor`: PC.
- `/health`: estado del servicio.

## Flujo para operador

1. Abrir `/captura` en el celular.
2. Tocar **Iniciar cámara**.
3. Colocar un parche correcto.
4. Tocar **1 · Marcar parche bueno** y dibujar alrededor de todo el parche.
5. Tocar **2 · Marcar texto bueno** y dibujar solo sobre las letras.
6. Tocar **3 · Guardar muestra maestra**.
7. Tocar **Inspeccionar producción**.
8. Colocar cada parche dentro de la guía azul.

## Flujo para PC

1. Abrir `/monitor`.
2. Escribir el código de 3 letras y 3 números que aparece en el celular.
3. Ver resultado en vivo.

## Despliegue Render

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

## Notas técnicas

- El análisis visual corre en el navegador del celular con OpenCV.js.
- El backend FastAPI solo retransmite métricas por WebSocket.
- La imagen no se manda al servidor.
- La detección del texto se basa en plantilla visual marcada en la muestra buena.
- El suavizado temporal reduce saltos de lectura.
- Si la seguridad de lectura es baja, el sistema muestra **NO LEE** o **REVISAR**, no rechaza automáticamente.

## Recomendación física

Para mejores resultados:

- Celular fijo en soporte.
- Luz constante y pareja.
- Prenda siempre en la misma zona.
- Fondo sin sombras fuertes.
- Crear una muestra maestra por tipo de parche/texto.
