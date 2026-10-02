# Arquitectura

## Stack

- **Node.js 22 + Express 4**, páginas renderizadas en el servidor (SEO y rapidez en celulares). Motor de vistas propio sin dependencias (`src/lib/html.js`): plantillas literales con **escape automático** de todo lo interpolado.
- **MongoDB + Mongoose 8**. Sesiones en MongoDB (`connect-mongo`).
- **JavaScript del cliente** mínimo y sin frameworks (`public/js/app.js`): el sitio funciona sin JS; con JS agrega calendario en vivo, favoritos, chat, push y confirmaciones.
- **Archivos**: Cloudinary en producción (API REST firmada, sin SDK), disco local en desarrollo. MongoDB guarda solo URL, tipo, metadata, propietario, estado y orden.
- **Pagos**: interfaz de proveedor (`src/services/payments/`): Mercado Pago (Checkout Pro + split) y un simulador para desarrollo.
- **Notificaciones**: in-app, email (Resend o consola), Web Push (VAPID implementado sin dependencias y testeado con los vectores del RFC 8291) y WhatsApp (Meta Cloud API).
- **Heroku**: `Procfile` (web + release que sincroniza índices), Heroku Scheduler para automatizaciones.

## Carpetas

```
src/
  app.js                 Express: seguridad, sesión, CSRF, contexto de vistas, rutas, errores
  server.js              arranque, apagado prolijo, jobs en proceso
  config/                variables de entorno y conexión a MongoDB
  lib/                   utilidades puras: html, fechas con zona horaria, validación, dinero, tokens, archivos, cifrado, web push
  models/                28 colecciones (ver abajo)
  services/              lógica de negocio
    availability.js        cálculo de horarios libres (puro + capa de datos)
    bookings.js            reservas, bloqueo anti doble reserva, cancelación, reprogramación, cierre
    commission.js          reglas de comisión y desglose de precios
    cancellation.js        política de cancelación y reparto de reembolsos
    ranking.js             intención de búsqueda, promedio bayesiano, perfiles nuevos
    search.js              búsqueda, tarjetas, patrocinados
    payments/              orquestación, Mercado Pago, simulador
    payouts.js             liquidaciones (modelos platform/offline)
    reviews.js, messaging.js, notifications.js, email.js, whatsapp.js
    specialists.js         alta, reclamo, moderación de cambios, completitud, sincronización de búsqueda
    media.js, storage.js   subida validada por contenido real; local/Cloudinary
    stats.js               métricas por día y tableros
    automation.js          recordatorios, cierre automático, reseñas, volver a reservar, vencimientos, conciliación
    audit.js, settings.js, auth.js
  middleware/            auth/roles/CSRF/flash, rate limit, uploads
  routes/                public, auth, booking, account (/mi), specialist (/panel), admin (/admin), api, webhooks
  views/                 layout, componentes y pantallas por área
public/                  css, js, service worker, manifest, íconos
scripts/                 seed, jobs, create-admin, sync-indexes, vapid
test/                    tests de lógica y render de todas las pantallas
```

## Colecciones

`users`, `specialists`, `services`, `categories`, `availabilities`, `bookings`, `bookingslots`, `payments`, `refunds`, `payouts`, `commissionrules`, `reviews`, `conversations`, `messages`, `favorites`, `notifications`, `media`, `certifications`, `verificationrequests`, `promotions`, `sponsoredplacements`, `auditlogs`, `settings`, `contents`, `reports`, `tickets`, `statdailies`, `counters`, más `sessions`.

Todas tienen timestamps y estados explícitos. Índices relevantes:

- `services`: `search.visible + search.categorySlug + rating.weighted`, `2dsphere` en `search.geo`, índice de texto en español con pesos (título, categoría, resumen, especialista, barrio).
- `specialists`: `slug` único, `2dsphere`, texto.
- `bookings`: `code` único, `specialist + start`, `user + start`, `status + paymentDeadline`.
- `bookingslots`: **único** `specialist + slot` (anti doble reserva) y TTL en `expiresAt`.
- `reviews`: **único** por `booking` (una reseña verificada por reserva).
- `notifications`: TTL de 180 días y `dedupeKey` único para avisos automáticos.

## Decisiones técnicas clave

### Evitar doble reserva

1. La pantalla muestra horarios libres, pero **el backend vuelve a calcular la disponibilidad** al confirmar.
2. Cada reserva ocupa bloques de 5 minutos (inicio → fin + tiempo entre sesiones) en `bookingslots`, con índice único `(specialist, slot)`. Dos reservas superpuestas no pueden insertarse nunca, aunque lleguen al mismo milisegundo y sin transacciones.
3. Las reservas impagas bloquean el horario por un tiempo (`paymentWindowMinutes`); el índice TTL libera los bloques solo y un job marca la reserva como vencida.
4. Si un pago llega después de vencido el plazo, se intenta recuperar el horario; si ya está tomado, se reembolsa automáticamente.

### Histórico inmutable

La reserva guarda una **fotografía** de los datos contractuales: precio, recargo, descuento, total, comisión (tasa, regla e importe), neto del especialista, costo estimado del procesador, duración, modelo de cobro, nombres y la política de cancelación vigente. Cambiar el precio de un servicio no altera reservas anteriores.

### Zona horaria

Todo se guarda en UTC y se interpreta en `America/Montevideo` con `Intl` (`src/lib/dates.js`), sin depender de la zona del servidor de Heroku.

### Búsqueda y escala

Los datos del especialista necesarios para buscar (nombre, zona, geo, verificación, "nuevo") se copian en cada servicio (`Service.search`) y se sincronizan al cambiar el perfil. Así una búsqueda es una sola consulta indexada sobre `services`, apta para 30.000+ especialistas. El ranking se aplica sobre hasta 300 candidatos; la disponibilidad real solo se calcula para los 40 mejores cuando la intención es temporal ("hoy").

### Estadísticas

Se agregan por día con `$inc` (`statdailies`) en lugar de guardar cada evento; no se cuentan recargas de la misma sesión ni visitas del propio especialista.

### Seguridad

- Contraseñas con bcrypt (12 rondas), bloqueo temporal tras 8 intentos, respuestas que no revelan si un email existe.
- Sesión regenerada al iniciar sesión; cookie `httpOnly`, `sameSite=lax`, `secure` en producción.
- CSRF en todos los formularios y llamadas `fetch`.
- Roles y permisos verificados en cada ruta; cada recurso se valida contra su dueño.
- Validación en backend de todos los formularios (`src/lib/validate.js`).
- Rate limiting por tipo de acción (login, API, reservas, formularios, uploads).
- Helmet con CSP estricta (sin scripts de terceros), HSTS y redirección a HTTPS.
- Archivos validados por contenido real (magic bytes), tamaño, cantidad y duración de video; documentos de identidad privados, servidos solo a administración con registro en auditoría.
- Tokens OAuth de Mercado Pago cifrados con AES-256-GCM.
- Auditoría de acciones sensibles (quién, qué, cuándo, valor anterior y nuevo).

### Privacidad

Datos públicos mínimos: nombre + inicial en reseñas; direcciones exactas solo con reserva confirmada; teléfonos según preferencia del usuario; exportación y eliminación de cuenta desde `/mi/privacidad`.
