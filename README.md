# Inspector Industrial de Parches V3

Sistema web de inspección visual en tiempo real para parches bordados sobre prendas de tejido de punto.

## Qué cambió en V3

- Flujo guiado para operador: cámara → tarjeta 7×7 → parche.
- Botón claro: **Ya puse la tarjeta · Calibrar**.
- Se eliminaron términos técnicos visibles como “offset X/Y” en la pantalla principal.
- Ahora se muestra lenguaje operativo: “texto a la derecha”, “texto arriba”, “texto inclinado”.
- Configuración simple por nivel de exigencia: Normal, Estricto o Flexible.
- Ajustes avanzados siguen disponibles, pero escondidos.
- Mejora de detección de texto con varias estrategias:
  - umbral adaptativo oscuro,
  - umbral adaptativo claro,
  - Otsu oscuro,
  - Otsu claro,
  - bordes por Canny.
- El sistema elige el candidato de texto más probable por área, componentes, relleno y posición.

## Flujo de uso

1. Abrir `/captura` en el celular.
2. Tocar **Iniciar cámara**.
3. Colocar la tarjeta 7×7 cm con interior negro 5×5 cm dentro de la guía.
4. Cuando aparezca estable, tocar **Ya puse la tarjeta · Calibrar**.
5. Retirar la tarjeta.
6. Colocar el parche dentro de la guía.
7. Leer resultado: OK, MAL o INESTABLE.
8. Abrir `/monitor` en PC e ingresar el código del celular.

## Rutas

- `/captura`: captura móvil.
- `/monitor`: monitor PC.
- `/health`: estado del servicio.

## Render

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

## Nota operativa

Si el celular se mueve después de calibrar, hay que volver a calibrar. La escala depende de la distancia entre cámara y tarjeta/parche.
