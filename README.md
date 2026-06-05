# Inspector Industrial de Parches V5

Webapp de inspección visual para smartphone + monitor PC en vivo.

## Flujo V5

1. Abrir `/captura` en el celular.
2. Iniciar cámara.
3. Colocar tarjeta física 7×7 cm con cuadro negro interior 5×5 cm.
4. Tocar **Calibrar tarjeta 7×7** cuando la app indique tarjeta lista.
5. Retirar la tarjeta.
6. Colocar un parche bueno.
7. Si la app no detecta bien el texto, tocar **Marcar texto manual** y dibujar un rectángulo solo sobre las letras.
8. Tocar **Guardar parche bueno**.
9. Inspeccionar parches de producción contra esa muestra.

## Cambios V5

- Agrega marcado manual del bloque de texto para entrenar la muestra buena.
- Guarda una plantilla visual del texto de la muestra y luego la busca por coincidencia dentro de la zona esperada.
- El texto ya no se busca “a ciegas” en todo el parche cuando existe muestra buena.
- Mantiene el flujo para operador: tarjeta → muestra buena → inspección.
- Si la lectura del texto es insegura, muestra **REVISAR** o **NO LEE**, no rechaza automáticamente.
- Mejor lenguaje de operación y soporte para casos donde el bordado/textura confunde a OpenCV.

## Render

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

## Rutas

- `/captura` para el celular.
- `/monitor` para la PC.
- `/health` para revisar servicio.
