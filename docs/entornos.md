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

## 3. GitHub Environments (para CI/CD)

En GitHub (**Settings → Environments**), configura dos ambientes (`staging` y `production`) con los siguientes secretos por ambiente:

- `SUPABASE_PROJECT_ID`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_ACCESS_TOKEN`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
