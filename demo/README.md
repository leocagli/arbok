# Arbok Social Demo

Demo frontend (HTML + JS) conectado al SDK real de `arbok` para:

- conectar MetaMask
- crear/actualizar perfil on-chain
- publicar posts
- seguir usuarios por UUID

## Requisitos

- Node.js 16 o superior
- MetaMask en el navegador
- Build del proyecto generado en `dist/`

## Ejecutar

1. Compilar la libreria en la raiz del proyecto:

```bash
npm run build
```

2. Levantar el servidor del demo:

```bash
cd demo
node server.js
```

3. Abrir:

```text
http://localhost:8000
```

## Notas

- El demo importa el SDK desde `/dist/index.mjs`.
- Si ves el error "No se encontro /dist/index.mjs", falta ejecutar `npm run build`.
- El UUID del usuario se deriva de la wallet conectada (`user-<address-sin-0x>`).
