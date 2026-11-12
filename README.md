# CanchaYa

Sistema multi-recinto para reservar canchas (pádel y fútbol 5) por WhatsApp.

## Documentación principal

- **Plan de trabajo y arquitectura:** `docs/plan.md`
- **Requisitos funcionales y no funcionales:** `docs/requisitos.md`
- **Decisiones de arquitectura (ADR):** `docs/adr/`
- **Entornos y variables:** `docs/entornos.md`
- **Wireframes del panel operativo:** `docs/ux/wireframes-panel.md`
- **Backlog:** `backlog/backlog.csv`
- **Contexto y reglas para agentes:** `AGENTS.md`

## Comandos principales

```bash
npm run dev          # Levanta el panel web (@canchaya/web) en desarrollo
npm run lint         # Ejecuta ESLint en todos los paquetes
npm run typecheck    # Verifica tipos de TypeScript en todo el monorepo
npm run test         # Ejecuta la suite de pruebas unitarias (Vitest)
npm run build        # Compila las aplicaciones y paquetes del monorepo
npm run format:check # Verifica formato con Prettier
```
