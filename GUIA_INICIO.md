# Guía de inicio (Antigravity + GitHub)

## 0. Requisitos (una sola vez)

1. Git: https://git-scm.com/downloads
2. GitHub CLI (gh): https://cli.github.com -> luego en terminal: `gh auth login`
3. Node.js 22 LTS: https://nodejs.org
4. Python 3: https://www.python.org/downloads
5. Antigravity: descárgalo desde el sitio oficial de Google Antigravity e instálalo.
   En el primer arranque elige "empezar desde cero" o importa tu config de VS Code.
   Políticas recomendadas al inicio: Terminal = "Request review" (pide aprobación),
   Review Policy = "Request review". Sube la autonomía cuando confíes en el flujo.

## 1. Crear el repositorio

1. Descomprime este kit en una carpeta llamada `canchaya`.
2. Abre una terminal en esa carpeta y ejecuta:
   ```
   git init -b main
   git add .
   git commit -m "chore: kit inicial del proyecto (CY-010)"
   gh repo create canchaya --private --source=. --remote=origin --push
   ```
   (Usa `--public` si quieres protección de ramas en plan gratuito.)

## 2. Configurar GitHub automáticamente

```
python scripts/setup_github.py --dry-run     # revisa qué hará
python scripts/setup_github.py               # ramas, protecciones, etiquetas, milestones, 68 issues
```

- Si la protección de ramas falla (repo privado + plan gratuito), configúrala a mano:
  Settings > Branches > Add rule para `main` y `develop`: requerir Pull Request,
  bloquear force push y borrado.
- Después del primer CI exitoso, agrega el check "ci" como requerido en esas reglas.

## 3. Tablero (Projects)

En GitHub: pestaña Projects > New project > Board. Columnas: Backlog, Listo, En progreso,
En revisión, En pruebas, Hecho. Agrega los issues (Add items) y los campos Sprint y Puntos.

## 4. Abrir en Antigravity

1. File > Open Folder > carpeta `canchaya`.
2. Antigravity lee `AGENTS.md` automáticamente como reglas del proyecto.
3. Los workflows de `.agent/workflows/` se invocan escribiendo `/` en el chat del agente:
   `/tomar-ticket`, `/revisar-pr`, `/cerrar-sprint`, `/nuevo-adr`.

## 5. Primer prompt (pégalo en el agente)

> Lee AGENTS.md, docs/requisitos.md y backlog/backlog.csv. Vamos a trabajar el ticket CY-012
> (inicializar Next.js con TypeScript, ESLint, Prettier y estructura apps/web + packages/core).
> Antes de escribir código dime tus dudas y propón un plan. Usa la rama feature/CY-012-nextjs-base
> desde develop.

## 6. Orden recomendado de trabajo

1. Esta semana: CY-001, CY-004, CY-010 a CY-012 (reunión con dueño, spike de WhatsApp, base del repo).
2. Sprint 1: CY-013 a CY-021.
3. No pases a la Fase 3 sin haber cerrado CY-017 (doble reserva) y CY-018 (RLS).

## 7. Ritmo semanal

Lunes: elige tickets (20-25 puntos). Diario: un ticket a la vez, con rama y PR.
Viernes: `/cerrar-sprint`, release `develop -> main` por PR y tag.

## 8. Buenas prácticas con el agente

- Un ticket por conversación. Pide plan antes del código.
- Revisa tú los cambios en reglas de disponibilidad, pagos y RLS.
- No des secretos al agente: usa `.env` (ignorado por git).
