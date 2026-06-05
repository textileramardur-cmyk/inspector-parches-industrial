# Inspector Industrial de Parches V4

Webapp de inspección visual para smartphone + monitor PC en vivo.

## Flujo V4

1. Abrir `/captura` en el celular.
2. Iniciar cámara.
3. Colocar tarjeta física 7×7 cm con cuadro negro interior 5×5 cm.
4. Tocar **Calibrar tarjeta 7×7** cuando la app indique tarjeta lista.
5. Retirar la tarjeta.
6. Colocar un parche bueno.
7. Tocar **Guardar parche bueno**.
8. Inspeccionar parches de producción contra esa muestra.

## Cambios V4

- Flujo para operador normal: tarjeta → muestra buena → inspección.
- Ya no se compara contra un centro matemático rígido, sino contra una muestra correcta.
- Suavizado temporal para reducir brincos en pantalla.
- Calibración más robusta: Otsu, umbrales fijos, adaptativo y bordes.
- Si la lectura del texto es insegura, muestra **REVISAR** o **NO LEE**, no rechaza automáticamente.
- Lenguaje menos técnico en la interfaz.

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
