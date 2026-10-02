# Alternativa

Marketplace de terapias, bienestar y disciplinas alternativas para Uruguay: **descubrir → comparar → reservar → pagar → realizar → valorar → volver a reservar**.

Hecho con **Node.js + Express + EJS**, con la **misma estructura de carpetas que Relámpago** (controladores, vistas, modelos, servicios y rutas). Mobile first, renderizado en el servidor y listo para Heroku.

## Probarlo en 1 minuto

```bash
npm install
npm start          # http://localhost:3000
```

No hace falta configurar nada: la primera vez se generan solos los **datos de prueba** (`data/db.json`) con especialistas, servicios, fotos, reservas, pagos, reseñas, mensajes y estadísticas. Los pagos usan la **pasarela simulada** (sin dinero real).

### Usuarios de prueba

En `/ingresar` aparece un botón **Entrar** para cada uno. Contraseña de todos: `alternativa2026`.

| Usuario | Rol | Qué tiene para probar |
|---|---|---|
| `admin@alternativa.uy` | Administración | Todo el panel `/admin`: pendientes, verificaciones, reembolso fallido, pago en disputa, incidencias, denuncias, liquidaciones, configuración |
| `especialista@alternativa.uy` | Especialista (Lucía Fernández, masajes en Pocitos) | Agenda llena, sesiones de hoy, reservas por confirmar, clientes, reseñas, estadísticas, ingresos, Mercado Pago vinculado, promoción, destacado, Plan Profesional, video y WhatsApp |
| `reiki@alternativa.uy` | Especialista (Martín Sosa, reiki) | Confirma reservas a mano, verificación de identidad y certificación pendientes, solicitud de destacado |
| `nuevo.especialista@alternativa.uy` | Especialista recién registrado (Diego) | Ficha en borrador con la lista de lo que falta para publicar |
| `usuario@alternativa.uy` | Usuario (Sofía Rodríguez) | Próxima reserva presencial (mapa + WhatsApp), reserva online pagada, realizada y reseñada, realizada sin valorar, cancelada con reembolso, reprogramada, pendiente de pago, favoritos, mensajes y una consulta de soporte |
| `nuevo.usuario@alternativa.uy` | Usuario recién registrado (Juan) | Cuenta vacía para hacer la primera reserva |

Además: el perfil "Centro Shanti" fue cargado por administración y se puede **reclamar** en `/reclamar/demo-reclamar-shanti`, y el código `BIENVENIDA` da 15% de descuento.

El recorrido completo, pantalla por pantalla, está en [`docs/pantallas.md`](docs/pantallas.md).

## Qué incluye

- **Público**: inicio con búsqueda en lenguaje natural ("masaje hoy cerca", "reiki online"), categorías con foto y URL amigable (`/masajes`), fichas con galería, video, **Google Maps** y botón de **WhatsApp**, detalle de servicio, reseñas verificadas, blog, preguntas frecuentes, páginas legales, sitemap.
- **Usuarios** (`/mi`): reserva con calendario de disponibilidad real, pago, mis reservas, cancelar con vista previa del reembolso, reprogramar, valorar, volver a reservar, favoritos, mensajes, avisos, privacidad (exportar/eliminar datos), soporte.
- **Especialistas** (`/panel`): alta guiada, perfil y apariencia, fotos y video, servicios, agenda (día/semana/mes, horarios, bloqueos, vacaciones), reservas, clientes, mensajes, estadísticas, ingresos, facturación, reseñas, verificación, certificaciones, cobros con Mercado Pago, promociones, destacados, plan profesional.
- **Administración** (`/admin`): resumen, pendientes, estadísticas, especialistas (crear, invitar a reclamar, verificar, suspender, aprobar cambios), usuarios, servicios, categorías, reservas (cancelar con % de reembolso, ausencias, incidencias), pagos, comisiones, reembolsos, liquidaciones, reseñas, moderación, denuncias, destacados, promociones, contenido, avisos, configuración del negocio, auditoría y soporte.
- **Automático**: vencimiento de reservas impagas, recordatorios, cierre de sesiones realizadas, pedido de reseñas, "volver a reservar", conciliación de pagos, destacados y promociones que empiezan y terminan solos.

## Estructura (igual que Relámpago)

```
app.js            arranque de Express
config/           variables de entorno, almacenamiento JSON (store.js), MongoDB opcional (db.js)
controllers/      un controlador por área (auth, público, reservas, cuenta, panel, admin…)
middlewares/      sesión y roles, seguridad (CSRF, cabeceras, límites), subida de archivos, errores
models/           modelos de datos (campos documentados al principio de cada archivo)
routes/           URLs → controladores
services/         reglas de negocio (comisiones, cancelaciones, disponibilidad, pagos, ranking…)
views/            vistas EJS: partials/, public/, auth/, reservas/, cuenta/, panel/, admin/, errores/
public/           css, js, imágenes (img/demo = ilustraciones de los datos de prueba)
scripts/          seed.js (datos de prueba), tareas.js, vapid.js
data/             db.json (se genera solo)
uploads/          archivos subidos (publico/ y privado/)
docs/             pantallas.md, arquitectura.md, decisiones.md
test/             pruebas (npm test)
```

Más detalle en [`docs/arquitectura.md`](docs/arquitectura.md). Decisiones de producto (pagos, reputación, cancelaciones) en [`docs/decisiones.md`](docs/decisiones.md).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start` | Inicia el sitio (puerto `PORT`, por defecto 3000) |
| `npm run dev` | Igual, reiniciando al guardar cambios |
| `npm run seed` | Borra los datos y genera los de prueba de nuevo (detené el servidor antes) |
| `npm run tareas` | Corre una vez las tareas automáticas (el servidor ya las corre cada 5 minutos) |
| `npm run vapid` | Genera las claves para notificaciones push |
| `npm test` | Pruebas de reglas de negocio y de los datos de prueba |

Requisito: Node.js 18 o superior.

## Configuración

Todo es opcional; copiá `.env.example` como `.env` para cambiar algo. Las más importantes:

| Variable | Para qué |
|---|---|
| `APP_ENV` | `desarrollo`, `staging` o `production`. **`production` = dinero real**: bloquea la pasarela simulada |
| `APP_URL` | URL pública (emails, Mercado Pago, webhooks) |
| `SESSION_SECRET` | Cadena larga y aleatoria |
| `MODO_DEMO` / `CLAVE_DEMO` | Muestra los usuarios de prueba en el ingreso / su contraseña |
| `PAYMENT_PROVIDER` | `simulado` o `mercadopago` (+ `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`) |
| `EMAIL_PROVIDER` | `consola` (los emails se ven en Administración → Avisos) o `resend` (+ `RESEND_API_KEY`) |
| `GOOGLE_MAPS_API_KEY` | Opcional: sin clave se usa el mapa público de Google |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Opcional: avisos automáticos por WhatsApp. Los botones de WhatsApp funcionan sin esto |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Opcional: notificaciones push (`npm run vapid`) |

Las reglas del negocio (comisión, plazos de pago, política de cancelación, moderación, reseñas, contacto) se cambian sin tocar código desde **Administración → Configuración**.

## Heroku

1. Subí el código al repositorio y conectalo a la app de Heroku (Deploy → GitHub) o usá `git push heroku main`.
2. En **Settings → Config Vars** cargá como mínimo `SESSION_SECRET`, `APP_URL` y `APP_ENV=staging`. Si la app ya tenía variables de la versión anterior (`MONGODB_URI`, `PAYMENT_PROVIDER=simulated`, etc.) pueden quedar: `simulated` se interpreta como `simulado` y MongoDB no se usa mientras `USAR_MONGO` no sea `true`.
3. El `Procfile` ya tiene `web: npm start`.

**Importante:** el disco de Heroku se borra en cada reinicio (al menos una vez por día). Con el archivo JSON eso significa que el sitio **vuelve a los datos de prueba** después de cada reinicio y se pierden las fotos subidas. Para una demo es ideal; para producción hay que activar MongoDB (ver `config/db.js`) y guardar los archivos en un servicio externo.

## Paso a producción (checklist)

- `APP_ENV=production`, `MODO_DEMO=false`, `SESSION_SECRET` nuevo.
- `PAYMENT_PROVIDER=mercadopago` con credenciales reales y webhook configurado en `APP_URL/webhooks/mercadopago`.
- `EMAIL_PROVIDER=resend` con dominio verificado.
- MongoDB activo y almacenamiento externo para archivos.
- Revisión legal de Términos, Privacidad y Política de cancelación (editables en Administración → Contenido).
