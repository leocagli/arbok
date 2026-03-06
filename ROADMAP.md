# Arbok Roadmap (Q1–Q2 2026)

## Objetivo
Fortalecer Arbok como librería social sobre Arkiv con foco en:
- Conectividad confiable a endpoints Arkiv.
- Resiliencia de red (fallback/retry/timeout).
- Ejemplos reales basados en use cases públicos de Arkiv.
- Observabilidad y documentación operativa para integradores.

---

## Principios de ejecución
- Priorizar estabilidad de red antes de nuevas features.
- Mantener compatibilidad con integraciones legacy durante la migración.
- Evitar dependencias operativas en un solo endpoint.
- Publicar cambios con métricas verificables.

---

## Hitos por semana

## Semana 1 — Baseline de conectividad
### Entregables
- Script de healthcheck para:
  - Arkiv RPC (`POST` JSON-RPC con `eth_chainId` y `web3_clientVersion`).
  - Sitio principal y dev portal.
  - Use cases (`copypal`, `imagedb`, `filedb`, `webdb`, `usecases`).
- Reporte JSON/Markdown con estado, latencia y errores.

### Criterios de éxito
- 100% de endpoints críticos monitoreados.
- Detección explícita de hostname inválido o no resoluble.

---

## Semana 2 — Fallback de RPC y hardening de transporte
### Entregables
- Política de conexión con:
  - Endpoint primario + secundarios.
  - Retry exponencial con jitter.
  - Timeouts diferenciados (lectura/escritura).
- Modo degradado para consultas de solo lectura.

### Criterios de éxito
- Recuperación automática ante caída del endpoint primario.
- Tiempo de recuperación objetivo: < 10s para operaciones de lectura.

---

## Semana 3 — Observabilidad y diagnóstico
### Entregables
- Logging estructurado para errores de red y RPC.
- Códigos de error normalizados (`dns-failure`, `rpc-timeout`, `rpc-4xx`, `rpc-5xx`).
- Guía rápida de troubleshooting para integradores.

### Criterios de éxito
- Trazabilidad completa de fallos de conexión.
- Diagnóstico en < 5 minutos sin inspección manual profunda.

---

## Semana 4 — Ejemplos productivos (Use Cases)
### Entregables
- `examples/copypal-lite`: notas/copiado temporal sobre Arkiv.
- `examples/imagedb-lite`: metadatos + versionado básico de imágenes.
- `examples/filedb-lite`: carga por chunks y reensamblado de archivos.
- `examples/webdb-lite`: publicación de assets estáticos con verificación.

### Criterios de éxito
- Cada ejemplo con README ejecutable en < 10 minutos.
- Cada ejemplo validado contra Kaolin testnet.

---

## Semana 5 — Documentación operativa y matriz de endpoints
### Entregables
- Matriz oficial de endpoints soportados (RPC, WS, Explorer, Faucet).
- Tabla de compatibilidad de red por entorno (dev/testnet).
- Recomendaciones de configuración para Node y browser.

### Criterios de éxito
- Cero URLs obsoletas en documentación principal.
- Checklist de integración inicial de una página.

---

## Semana 6 — Automatización y release de confiabilidad
### Entregables
- Workflow CI programado (diario) para healthchecks.
- Badge de estado de conectividad en README.
- Release de mantenimiento (`v0.1.x`) con changelog de estabilidad.

### Criterios de éxito
- Alertas de caída detectadas en menos de 24h.
- Release con mejoras medibles de confiabilidad.

---

## Backlog priorizado
1. Actualizar endpoint recomendado a `https://kaolin.hoodi.arkiv.network/rpc` en toda la documentación.
2. Añadir soporte explícito de `wss://kaolin.hoodi.arkiv.network/rpc/ws` para suscripciones.
3. Definir contrato de errores de red público en tipos exportados.
4. Publicar plantilla de issue para “RPC connectivity bug”.
5. Añadir script `npm run healthcheck` y salida machine-readable.

---

## Riesgos y mitigación
- Riesgo: cambios de infraestructura Arkiv sin anuncio previo.
  - Mitigación: healthcheck diario + fallback multi-endpoint.
- Riesgo: drift entre docs y runtime.
  - Mitigación: test de enlaces y endpoints como gate de CI.
- Riesgo: bloqueos por rate limit o WAF.
  - Mitigación: retry con backoff y límites de concurrencia.

---

## KPIs sugeridos
- Disponibilidad RPC efectiva (7d rolling): >= 99.5%.
- Tasa de errores de red por 1k requests: <= 5.
- MTTR de endpoint primario: <= 10 minutos.
- Tiempo de onboarding (quickstart funcional): <= 10 minutos.

---

## Definición de “Done” por release
- Healthchecks verdes durante 7 días consecutivos.
- Docs alineadas con endpoints activos.
- Ejemplos mínimos ejecutables y verificados.
- Changelog con mejoras de estabilidad y guía de migración cuando aplique.
