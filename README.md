# Inspector de Parches Industrial · V11 visual estable

Versión corregida para que el operador **vea siempre** qué está detectando la app.

## Cambios clave

- El overlay ya no desaparece entre frames.
- La guía azul siempre se dibuja encima del video.
- El parche detectado se enmarca en verde.
- El texto detectado se enmarca en naranja.
- Si no lee texto, se muestra la zona inferior donde está buscando.
- No permite guardar muestra buena si no hay lectura estable de texto.
- El mensaje de estado explica si el problema es escena, parche o texto.

## Uso

1. Abrir `/captura` en el celular.
2. Iniciar cámara.
3. Colocar el parche completo dentro de la guía azul.
4. Esperar que el parche quede enmarcado en verde.
5. Esperar que el texto quede enmarcado en naranja.
6. Cuando diga `MUESTRA LISTA`, guardar la muestra buena.
7. Iniciar inspección de producción.

## Render

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```
