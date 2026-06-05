# Inspector de Parches Industrial · V9 robusta

Sistema web para inspección visual de parches bordados usando un smartphone y un monitor de PC.

## Enfoque de esta versión

Esta versión está diseñada para un ambiente real de piso, no para una demo perfecta.

Principios:

- Sin dibujar rectángulos.
- Sin tarjeta 7x7 obligatoria.
- Fondo liso y contrastante como referencia física.
- Cámara preferentemente fija.
- Primero se guarda una muestra buena.
- La producción se compara contra esa muestra.
- Si la lectura no es segura, no rechaza la pieza.

Estados principales:

- **OK**: lectura estable y alineada contra la muestra buena.
- **REVISAR**: lectura confiable, pero fuera de tolerancia contra la muestra.
- **NO LEE**: ve el parche, pero no confirma el texto.
- **NO VEO PARCHE**: no puede separar el parche del fondo.
- **AJUSTAR ESCENA**: hay problemas de luz, movimiento o fondo.

## Flujo de uso

1. Abrir `/captura` en el celular.
2. Iniciar cámara.
3. Colocar un parche bueno sobre fondo liso mate.
4. Esperar que diga **MUESTRA LISTA**.
5. Tocar **Guardar muestra buena**.
6. Tocar **Inspeccionar producción**.
7. Colocar los parches de producción dentro de la guía.
8. Abrir `/monitor` en PC y conectar con el código de sesión del celular.

## Condiciones recomendadas

- Fondo liso, mate, sin textura fuerte.
- Color del fondo diferente al parche.
- Luz pareja y sin reflejos fuertes.
- Un solo parche visible.
- Fondo visible alrededor del parche.
- Celular fijo o lo más estable posible.

## Rutas

- `/captura`: vista móvil.
- `/monitor`: monitor PC.
- `/health`: prueba de servicio.

## Despliegue en Render

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

## Arquitectura

- Frontend móvil: análisis visual en navegador.
- Backend FastAPI: solo sirve archivos y retransmite telemetría por WebSocket.
- Monitor PC: recibe datos, no analiza video.

## Importante

Esta versión no usa milímetros reales por defecto. Trabaja por comparación relativa contra una muestra buena. Para milímetros reales se puede agregar después un modo supervisor con calibración física.
