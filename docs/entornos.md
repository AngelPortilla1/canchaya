# Ambientes y variables de entorno (Supabase, GitHub y Vercel)

CanchaYa opera con dos proyectos separados en Supabase para aislar las pruebas de los datos reales del recinto:

| Ambiente     | Proyecto Supabase  | Rama Git                      | Uso                                                          |
| ------------ | ------------------ | ----------------------------- | ------------------------------------------------------------ |
| `staging`    | `canchaya-staging` | `develop` y ramas `feature/*` | Desarrollo local, pruebas de migraciones y validación previa |
| `production` | `canchaya-prod`    | `main`                        | Operación real del recinto piloto y clientes                 |

## 1. Desarrollo local

1. Copia la plantilla en la raíz del monorepo:
   ```bash
   cp .env.example .env
   ```
2. Completa `.env` **únicamente con las credenciales de `staging`** (`canchaya-staging`).
3. `apps/web/next.config.ts` carga automáticamente `.env.local` y `.env` desde la raíz del monorepo, por lo que no necesitas duplicar el archivo dentro de `apps/web/`.

## 2. Reglas de seguridad

- **Variables con prefijo `NEXT_PUBLIC_`:** se envían al navegador (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_ENV`). Son seguras únicamente porque todas las tablas de negocio tienen **Row Level Security (RLS)** activa por `tenant_id`.
- **Variables sin prefijo `NEXT_PUBLIC_`:** son exclusivas del servidor (`SUPABASE_SERVICE_ROLE_KEY`, `WHATSAPP_*`). Nunca deben importarse desde componentes de cliente ni imprimirse en logs.
- Usa las funciones `getPublicSupabaseEnv()`, `getServerSupabaseEnv()` y `getWhatsAppServerEnv()` de `apps/web/src/lib/env.ts` para validar variables al arrancar o atender peticiones.

## 3. GitHub Environments y despliegue automático (CI/CD)

El despliegue continuo se orquesta desde GitHub Actions para garantizar que las migraciones de Supabase (`supabase db push`) se apliquen exitosamente **antes** de publicar la aplicación web en Vercel:

- [`.github/workflows/deploy-staging.yml`](../.github/workflows/deploy-staging.yml): se dispara en cada push a `develop` (o manualmente con `workflow_dispatch`), aplica las migraciones en `canchaya-staging` y despliega en Vercel (`staging` / `preview`).
- [`.github/workflows/deploy-prod.yml`](../.github/workflows/deploy-prod.yml): se dispara en cada push a `main` o tag `v*.*.*`, solicita aprobación manual del ambiente `production`, aplica migraciones en `canchaya-prod` y despliega en Vercel (`--prod`).

### 3.1 Configuración en Vercel (una sola vez)

1. Crea o vincula el proyecto desde la raíz del monorepo ejecutando:
   ```bash
   npx vercel link
   ```
   Esto generará localmente `.vercel/project.json` (ignorado por Git) con los valores de `orgId` (`VERCEL_ORG_ID`) y `projectId` (`VERCEL_PROJECT_ID`).
2. En **Vercel Dashboard → Project Settings → General**:
   - **Framework Preset:** `Next.js`
   - **Root Directory:** `apps/web`
3. En **Vercel Dashboard → Account Settings → Tokens**, crea un token personal (`VERCEL_TOKEN`).
4. En **Vercel Dashboard → Project Settings → Environment Variables**, registra las variables de ejecución por ambiente:
   - **Preview (`staging`):** `NEXT_PUBLIC_APP_ENV=staging`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (con los valores de `canchaya-staging`).
   - **Production (`production`):** `NEXT_PUBLIC_APP_ENV=production`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (con los valores de `canchaya-prod`).

### 3.2 Configuración de GitHub Environments

En GitHub (**Settings → Environments**), crea dos ambientes:

1. **`staging`** (sin restricción de espera, rama permitida: `develop`).
2. **`production`** (activa **Required reviewers** con tu usuario para exigir aprobación manual antes de desplegar, rama permitida: `main` y tags `v*`).

Configura los siguientes **Environment secrets** en cada uno (`staging` y `production`):

| Secreto                         | Descripción                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN`         | Token personal de Supabase CLI (`https://supabase.com/dashboard/account/tokens`) |
| `SUPABASE_PROJECT_ID`           | Reference ID del proyecto (`canchaya-staging` o `canchaya-prod`)                 |
| `SUPABASE_DB_PASSWORD`          | Contraseña de la base de datos PostgreSQL del proyecto correspondiente           |
| `NEXT_PUBLIC_SUPABASE_URL`      | URL base del proyecto Supabase correspondiente                                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave pública (`anon` / `publishable`) del proyecto correspondiente              |
| `SUPABASE_SERVICE_ROLE_KEY`     | Clave secreta (`service_role` / `secret`) del proyecto correspondiente           |
| `VERCEL_TOKEN`                  | Token de acceso de Vercel CLI                                                    |
| `VERCEL_ORG_ID`                 | `orgId` obtenido en `.vercel/project.json`                                       |
| `VERCEL_PROJECT_ID`             | `projectId` obtenido en `.vercel/project.json`                                   |
