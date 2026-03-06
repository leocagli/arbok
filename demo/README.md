# Arbok Social Demo

Demo frontend (HTML + JS) conectado al SDK real de `arbok` para:

- conectar MetaMask
- crear/actualizar perfil on-chain
- subir foto de perfil directo a Arkiv CDN
- publicar posts
- adjuntar archivos al post (subida directa a Arkiv CDN)
- seguir usuarios por UUID
- previsualizar media subida desde Arkiv

## Requisitos

- Node.js 16 o superior
- MetaMask en el navegador
- Build del proyecto generado en `dist/`

## Ejecutar

1. Compilar la libreria en la raiz del proyecto:

```bash
npm run build
```

2. Levantar el servidor del demo (opcion Node):

```bash
cd demo
node server.js
```

Alternativa (Python):

```bash
cd demo
python -m http.server 8000
```

3. Abrir:

```text
http://localhost:8000
```

## Notas

- El demo importa el SDK desde `/dist/index.mjs`.
- Si ves el error "No se encontro /dist/index.mjs", falta ejecutar `npm run build`.
- El UUID del usuario se deriva de la wallet conectada (`user-<address-sin-0x>`).
- El RPC usado por defecto es `https://kaolin.hoodi.arkiv.network/rpc`.
- Si MetaMask no tiene la red Kaolin, el demo intenta agregarla/cambiarla automaticamente.
