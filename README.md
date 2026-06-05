# Inspector de Parches Industrial · V10 lectura inferior

Versión pensada para ambiente real de piso con fondo liso/contrastante, sin dibujo manual y sin tarjeta 7x7 obligatoria.

## Cambios V10

- La instrucción ya no tapa el parche dentro de la cámara.
- El botón de muestra ahora dice `Esperando parche`, `Esperando texto`, `Confirmando lectura` o `Guardar muestra buena`.
- Detector de texto mejorado para parches con escudo y texto pequeño en la placa inferior.
- El texto se busca primero en la zona inferior del parche, no en todo el escudo.
- Umbrales más tolerantes para texto pequeño y bajo contraste.
- Sigue sin rechazar si la lectura no es confiable.

## Flujo

1. Abrir `/captura` en celular.
2. Iniciar cámara.
3. Colocar un parche bueno sobre fondo liso y contrastante.
4. Esperar a que el botón diga `Guardar muestra buena`.
5. Guardar muestra.
6. Iniciar inspección de producción.
7. Abrir `/monitor` en PC y conectar con el código de sesión.

## Despliegue Render

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```
