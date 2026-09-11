# BotWSP — Recuperación ante desastres (Disaster Recovery)

Runbook de operación y recuperación del servicio **Evolution API** que corre en producción como **BotWSP** (`botwsp.saastech.com.py`).

> Este documento describe la instalación actual. Sirve para reconstruir el servicio desde cero o restaurarlo tras un fallo.

---

## 1. Resumen de la arquitectura

| Componente | Detalle |
|---|---|
| Aplicación | Evolution API v2.3.7 (fork propio `jrgonzalez3/evolution-api`) |
| Proceso | PM2, app `ApiEvolution`, `npm start` (= `tsx ./src/main.ts`) |
| Ruta | `/www/wwwroot/botwsp` |
| Base de datos | PostgreSQL 18 (tabla `evolution_db`, schema `evolution_api`, usuario `sistema`) |
| Cache | Redis **NO** se usa (`CACHE_REDIS_ENABLED=false`, usa `CACHE_LOCAL_ENABLED=true`) |
| Reverse proxy | Nginx → `127.0.0.1:8080` (con WebSocket) |
| Dominio | `botwsp.saastech.com.py` (proxy Cloudflare → IP `5.189.184.99`) |
| SSL | Let's Encrypt vía `acme.sh` (renovación automática) |

**IP pública del server:** `5.189.184.99` (IPv4) · `2a02:c207:2155:4577::1` (IPv6)

---

## 2. Dependencias del sistema

- Node.js v24 (ruta: `/www/server/nodejs/v24.19.0/bin/node`)
- PM2 (global, corre como `root`)
- PostgreSQL 18 (BT panel: `/www/server/pgsql/bin/`)
- Nginx (BT panel: `/www/server/nginx/sbin/nginx`)
- `acme.sh` para certificados (`/root/.acme.sh/acme.sh`)

---

## 3. Configuración clave (archivo `.env`)

El archivo `.env` **NO está versionado** (en `.gitignore`). Es la base de toda la config; si se pierde, **debe restaurarse desde backup**. Valores sensibles actuales:

- `SERVER_PORT=8080`, `SERVER_URL=https://botwsp.saastech.com.py`
- `DATABASE_PROVIDER=postgresql`
- `DATABASE_CONNECTION_URI=postgresql://sistema:<PASS>@localhost:5432/evolution_db?schema=evolution_api&connection_limit=1`
- `DATABASE_CONNECTION_CLIENT_NAME=botwsp`
- `AUTHENTICATION_API_KEY=<KEY GLOBAL>`
- Integraciones activas: `CHATWOOT_ENABLED=true`, `N8N_ENABLED=true`, `OPENAI_ENABLED=true`

> **Nota de seguridad:** jamás commits `.env`. Solo existe en el server y en backups del cliente.

### Flags de persistencia en BD (optimización aplicada)

Los clientes consumen datos en **tiempo real vía webhook** (independiente del guardado en BD), por eso se desactivó el persistido para reducir peso y concurrencia:

```
DATABASE_SAVE_DATA_NEW_MESSAGE=false   # no guarda mensajes nuevos
DATABASE_SAVE_MESSAGE_UPDATE=false     # no guarda estados leído/entregado/editado
DATABASE_SAVE_DATA_HISTORIC=false      # no guarda re-sync de historia
DATABASE_SAVE_DATA_CONTACTS=true       # se mantiene
DATABASE_SAVE_DATA_CHATS=true          # se mantiene
```

> Los webhooks, Chatwoot y N8N funcionan igual aunque el guardado esté apagado.

---

## 4. PM2 — gestión del proceso

```bash
# Ver estado
pm2 list

# Logs
pm2 logs ApiEvolution --lines 50 --nostream

# Reiniciar (por ej. tras cambiar .env)
pm2 restart ApiEvolution

# Persistencia de arranque (ya configurado, se inicia solo al boot)
pm2 startup systemd -u root --hp /root
pm2 save
```

Config de proceso en `ecosystem.config.js`:
- `cwd: /www/wwwroot/botwsp`
- `NODE_OPTIONS=--max-old-space-size=1024`
- `max_memory_restart: 1G`

---

## 5. Base de datos

### Conectar
```bash
PGBIN=/www/server/pgsql/bin
PGPASSWORD='<PASS sistema>' $PGBIN/psql -h 127.0.0.1 -U sistema -d evolution_db
```

### Restaurar desde backup (dump custom de `pg_dump`)
```bash
# 1) Crear rol y BD (si no existen)
sudo -u postgres $PGBIN/psql -h /tmp -c "CREATE ROLE sistema LOGIN PASSWORD '<PASS>';"
sudo -u postgres $PGBIN/psql -h /tmp -c "CREATE DATABASE evolution_db OWNER sistema;"

# 2) Restaurar (conecta por TCP 127.0.0.1: el socket requiere usuario postgres)
$PGBIN/pg_restore -h 127.0.0.1 -U postgres -d evolution_db --no-owner --no-privileges evolution_db_<fecha>.dump

# 3) Permisos
sudo -u postgres $PGBIN/psql -h /tmp -d evolution_db -c "GRANT ALL ON SCHEMA evolution_api TO sistema;"
```

### Generar el client de Prisma
```bash
cd /www/wwwroot/botwsp
export DATABASE_PROVIDER=postgresql
npx prisma generate --schema ./prisma/postgresql-schema.prisma
```

> La BD ya trae el esquema (backup completo), por lo que **no** se aplican migraciones. Solo se genera el client.

---

## 6. Instalación desde cero (reconstrucción)

```bash
cd /www/wwwroot
git clone git@github.com:jrgonzalez3/evolution-api.git botwsp
cd botwsp

# Instalar dependencias (npm v11 bloquea scripts por defecto → aprobarlos)
npm install --no-audit --no-fund
npm approve-scripts @ffmpeg-installer/linux-x64 @prisma/client @prisma/engines baileys esbuild prisma sharp protobufjs
npm install --no-audit --no-fund

# Restaurar .env desde backup
# Generar Prisma client + crear/restaurar BD (sección 5)

# Levantar con PM2
pm2 start ecosystem.config.js
pm2 save && pm2 startup systemd -u root --hp /root
```

---

## 7. Nginx y dominio

- Vhost: `/www/server/panel/vhost/nginx/botwsp.saastech.com.py.conf`
- Reverse proxy a `http://127.0.0.1:8080` con headers WebSocket (`Upgrade`/`Connection`).
- Recargar: `/www/server/nginx/sbin/nginx -s reload`
- Certificados en: `/www/server/panel/vhost/cert/botwsp.saastech.com.py/` (`fullchain.pem` + `privkey.pem`).

### Cloudflare
- Registro `botwsp` tipo **A** → `5.189.184.99` (proxied/naranja).
- SSL del dominio en **Full / Full (strict)** (requiere cert válido en origen, ya provisto por Let's Encrypt).
- El error **526** en Cloudflare = el cert del origen no es válido (revisar emisión de Let's Encrypt).

### Renovación SSL (acme.sh, automática)
```bash
/root/.acme.sh/acme.sh --issue -d botwsp.saastech.com.py --webroot /www/wwwroot/botwsp --server letsencrypt
/root/.acme.sh/acme.sh --install-cert -d botwsp.saastech.com.py --ecc \
  --fullchain-file /www/server/panel/vhost/cert/botwsp.saastech.com.py/fullchain.pem \
  --key-file /www/server/panel/vhost/cert/botwsp.saastech.com.py/privkey.pem \
  --reloadcmd "/www/server/nginx/sbin/nginx -s reload"
```
(acme.sh crea un cron que renueva solo.)

---

## 8. Copias de seguridad (recomendación)

- **Diario:** `pg_dump -Fc evolution_db > evolution_db_$(date +%Y%m%d-%H%M).dump` (guardar fuera del server).
- **`.env`:** copiar a un lugar seguro (no se versiona).
- **`instances/`:** contiene las sesiones WhatsApp conectadas; respaldar si se quiere conservar las sesiones.
- Probar la restauración del dump en un entorno aparte periódicamente.

---

## 9. Troubleshooting

| Síntoma | Causa / solución |
|---|---|
| `stream errored out / conflict replaced` en logs | La misma cuenta WhatsApp conectada en otro server. Apagar el otro server. |
| `disconnectionReasonCode: 401/403` | Sesión WhatsApp cerrada al migrar de IP. Re-escanear QR desde el manager. |
| Cloudflare error 526 | Cert del origen inválido. Reemitir Let's Encrypt (sección 7). |
| Webhook `ENOTFOUND <dominio>` | El webhook de una instancia apunta a un dominio que no existe; no bloquea el servicio. |
| RAM alta / reinicios frecuentes | Límite `1G` en `ecosystem.config.js`; revisar `pm2 logs ApiEvolution --err`. |