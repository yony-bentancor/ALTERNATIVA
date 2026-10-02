# Alternativa

Marketplace de especialistas en terapias, bienestar y disciplinas alternativas para Uruguay: **descubrir → comparar → reservar → pagar → realizar → valorar → volver a reservar**.

Mobile first, renderizado en el servidor (SEO), MongoDB y listo para Heroku.

## Qué incluye

- **Público**: home con búsqueda en lenguaje natural ("masaje hoy cerca", "reiki online"), categorías con URL amigable (`/masajes`), fichas de especialistas, detalle de servicio, reseñas, galería, blog, FAQ, páginas legales, sitemap y datos estructurados.
- **Usuarios**: reserva con calendario de disponibilidad real, pago único con Mercado Pago, mis reservas, cancelar con vista previa del reembolso, reprogramar, valorar, volver a reservar en 2–3 toques, favoritos, mensajes, notificaciones (in-app, email, push, WhatsApp), privacidad (exportar y eliminar datos), soporte.
- **Especialistas**: alta guiada, ficha con personalización acotada, fotos y video, servicios con reputación propia, agenda (día/semana/mes, horarios, descansos, vacaciones, bloqueos), reservas, clientes (mini CRM), estadísticas, ingresos, reseñas (responder / pedir revisión), verificación de identidad, certificaciones, cobros con Mercado Pago (OAuth), promociones, destacados, plan profesional.
- **Administración**: tablero, pendientes que requieren intervención, especialistas (crear, invitar a reclamar, verificar, suspender, moderar cambios), usuarios, servicios, categorías, reservas (cancelar con % de reembolso, ausencias, incidencias), pagos y conciliación, comisiones configurables, reembolsos, liquidaciones, reseñas, moderación, denuncias, destacados, promociones, configuración de negocio, avisos, contenido, auditoría y soporte.
- **Automatizaciones**: vencimiento de reservas impagas, recordatorios, cierre automático de sesiones, pedidos de reseña, recordatorio para volver a reservar, conciliación de pagos, campañas y promociones que empiezan/terminan solas.

El mapa completo de las 129 pantallas está en [`docs/pantallas.md`](docs/pantallas.md). Las decisiones de producto (modelo de pagos, reputación, cancelaciones) en [`docs/decisiones.md`](docs/decisiones.md) y la arquitectura en [`docs/arquitectura.md`](docs/arquitectura.md).

## Requisitos

- Node.js 22
- MongoDB 6+ (local o [MongoDB Atlas](https://www.mongodb.com/atlas))

## Puesta en marcha local

```bash
npm install
cp .env.example .env          # completá SESSION_SECRET y MONGODB_URI
npm run seed:demo             # categorías, contenido y datos de ejemplo
ADMIN_EMAIL=vos@mail.com ADMIN_PASSWORD='clave-segura-1' npm run create-admin
npm run dev                   # http://localhost:3000
```

Cuentas de ejemplo (contraseña `demo1234`): `cliente@demo.alternativa.uy` (usuario) y `laura@demo.alternativa.uy` (especialista).

En desarrollo los pagos usan la **pasarela simulada** (`PAYMENT_PROVIDER=simulated`): al reservar se abre una pantalla para aprobar o rechazar el pago, y el flujo completo (confirmación, notificaciones, reembolsos) funciona sin dinero real.

## Tests

```bash
npm test        # lógica de agenda, precios, comisiones, cancelaciones, ranking, seguridad y render de todas las pantallas
npm run lint
```

No necesitan base de datos.

## Despliegue en Heroku

1. **Base de datos**: crear un cluster en MongoDB Atlas y permitir el acceso desde Heroku. Copiar la cadena de conexión.
2. **App**:
   ```bash
   heroku create alternativa-staging
   heroku config:set NODE_ENV=production APP_ENV=staging APP_URL=https://alternativa-staging.herokuapp.com \
     MONGODB_URI='mongodb+srv://…' SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
     STORAGE_DRIVER=cloudinary CLOUDINARY_CLOUD_NAME=… CLOUDINARY_API_KEY=… CLOUDINARY_API_SECRET=… \
     EMAIL_PROVIDER=resend RESEND_API_KEY=… EMAIL_FROM='Alternativa <hola@alternativa.uy>' \
     PAYMENT_PROVIDER=simulated RUN_JOBS_IN_PROCESS=false
   git push heroku main
   heroku run npm run seed
   heroku run npm run create-admin -- vos@mail.com 'clave-segura-1'
   ```
   La fase `release` del `Procfile` sincroniza los índices de MongoDB en cada deploy.
3. **Automatizaciones**: agregar *Heroku Scheduler* y programar `npm run jobs` cada 10 minutos.
4. **Producción**: misma configuración con `APP_ENV=production`, dominio propio (`heroku domains:add`) y Mercado Pago real (abajo). En producción la app no arranca si falta algo crítico (secreto de sesión, Cloudinary, Mercado Pago) y no permite la pasarela simulada.

Entornos recomendados: **local → staging → producción**, cada uno con su base de datos y sus credenciales.

### Mercado Pago (split de pagos)

1. En [Mercado Pago Developers](https://www.mercadopago.com.uy/developers) crear la aplicación de Alternativa (Checkout Pro, marketplace).
2. Variables: `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `PAYMENT_PROVIDER=mercadopago`.
3. **Redirect URI** de OAuth: `https://TU_DOMINIO/panel/cuenta/cobros/mercadopago/callback`.
4. **Webhooks**: `https://TU_DOMINIO/webhooks/mercadopago`, eventos *Pagos* y *Contracargos*. Copiar la clave secreta a `MP_WEBHOOK_SECRET`.
5. Cada especialista vincula su cuenta desde **Panel → Cobros**. Con credenciales de prueba (`TEST-…`) se usa el sandbox automáticamente.

### Notificaciones push y WhatsApp (opcionales)

- Push: `npm run vapid` y cargar `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- WhatsApp: `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` de Meta Cloud API, con una plantilla aprobada llamada `alternativa_aviso` con dos parámetros (título y detalle).

### Backups

Activar los backups automáticos del cluster en MongoDB Atlas (snapshots diarios). Los archivos viven en Cloudinary.

## Configuración de negocio sin tocar código

Desde **Admin → Configuración**: comisión general y cómo se muestra el precio, modelo de cobro, costo estimado del procesador y quién lo absorbe, política de cancelación, parámetros de reseñas y ranking, exposición de perfiles nuevos, política de datos de contacto en mensajes, moderación, límites de archivos, recordatorios y automatizaciones. Las reglas de comisión por especialista, categoría o promoción se gestionan en **Admin → Comisiones**.
