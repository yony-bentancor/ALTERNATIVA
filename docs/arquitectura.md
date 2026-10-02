# Arquitectura

Misma estructura y orden de archivos que **Relámpago**: Express + EJS, controladores por área, modelos sobre un archivo JSON (con camino preparado a MongoDB), servicios con la lógica de negocio y rutas finas que solo conectan URL → middleware → controlador.

## Stack

- **Node.js ≥ 18 + Express 4**, páginas renderizadas en el servidor con **EJS** (SEO y rapidez en celulares).
- **5 dependencias**: `express`, `express-session`, `ejs`, `busboy` (subida de archivos) y `dotenv`. Seguridad, CSRF, límite de intentos, contraseñas (scrypt), cifrado (AES-256-GCM) y Web Push (VAPID) están escritos sin librerías extra.
- **Datos**: archivo `data/db.json` (como Relámpago). Si no existe, se genera solo con los datos de prueba. Escrituras agrupadas (150 ms) y atómicas (archivo temporal + renombrar). `config/db.js` documenta cómo pasar a MongoDB sin tocar controladores.
- **JavaScript del cliente** mínimo y sin frameworks (`public/js/app.js`): el sitio funciona sin JS; con JS agrega calendario en vivo, favoritos, chat, push y confirmaciones.
- **Archivos**: `uploads/publico` (fotos y videos, servidos en `/subidas`) y `uploads/privado` (documentos de identidad y certificados, servidos en `/archivos` solo al dueño y a administración).
- **Pagos**: interfaz de proveedor en `services/pagos/`: Mercado Pago (Checkout Pro + split con `marketplace_fee`, OAuth por especialista, webhooks firmados, reembolsos, contracargos, conciliación) y una pasarela **simulada** para pruebas.
- **Mapas**: Google Maps embebido (`maps.google.com/maps?q=…&output=embed`, sin clave) o la API oficial Maps Embed si se carga `GOOGLE_MAPS_API_KEY`. Botones "Abrir en Google Maps" y "Cómo llegar".
- **WhatsApp**: botones `wa.me` con mensaje prearmado (ficha, reserva, cliente, soporte) según la política de contacto; avisos automáticos opcionales por Meta Cloud API.
- **Avisos**: dentro de la app, email (consola o Resend), Web Push y WhatsApp.

## Carpetas

```
app.js                   Express: seguridad, sesión, CSRF, locales de vistas, rutas, errores, tareas automáticas
config/
  index.js               variables de entorno (.env / Config Vars de Heroku)
  store.js               almacenamiento en data/db.json (carga, guardado atómico, ids, numeradores)
  db.js                  conexión opcional a MongoDB (USAR_MONGO)
controllers/
  authController.js      ingreso (con usuarios de prueba), registro, verificación, recuperar clave, reclamar perfil
  publicoController.js   inicio, búsqueda, categorías, fichas, servicios, reseñas, blog, páginas, contacto
  reservaController.js   calendario, confirmación, pago (Mercado Pago / simulado), retorno
  apiController.js       JSON para el front: disponibilidad, horarios, favoritos, mensajes, push
  cuentaController.js    área del usuario (/mi): reservas, valorar, favoritos, mensajes, perfil, privacidad, ayuda
  panelController.js     panel del especialista: alta, inicio, estadísticas, ingresos, facturación
  fichaController.js     perfil, apariencia, fotos y video, servicios, verificación, certificaciones
  agendaController.js    agenda, horarios, bloqueos, reservas, clientes, mensajes
  negocioController.js   reseñas, configuración, cobros, promociones, destacados, plan
  adminController.js               resumen, pendientes, estadísticas, configuración, avisos, auditoría
  adminMarketplaceController.js    especialistas, verificaciones, usuarios, servicios, categorías, reservas
  adminDineroController.js         pagos, comisiones, reembolsos, liquidaciones
  adminConfianzaController.js      reseñas, moderación, denuncias, soporte
  adminCrecimientoController.js    destacados, promociones, contenido
middlewares/             auth (roles), seguridad (cabeceras, CSRF, límites), subida (busboy), locales, errores
models/                  Modelo base + 26 modelos (campos documentados al inicio de cada archivo)
routes/                  auth, publico, reservas, api, archivos, webhooks, cuenta (/mi), panel (/panel), admin (/admin)
services/                lógica de negocio (ver abajo)
views/
  partials/              head, header, sidebar, pie, tarjetas, mapa, whatsapp, gráficos, paginación…
  public/ auth/ reservas/ cuenta/ panel/ admin/ errores/
public/                  css, js, service worker, manifest, íconos, img/demo (ilustraciones de los datos de prueba)
scripts/                 seed.js (datos de prueba), tareas.js, vapid.js, contenido-paginas.js, demo/
data/                    db.json (se genera solo; no se sube al repositorio)
uploads/                 publico/ y privado/ (no se suben al repositorio)
test/                    pruebas de reglas de negocio y de los datos de prueba (npm test)
docs/                    pantallas, arquitectura y decisiones
```

### Servicios

| Archivo | Qué resuelve |
|---|---|
| `comision.js` | precedencia de reglas (promoción → especialista → categoría → general) y desglose de precio (tarifa sumada o incluida, costo de pasarela) |
| `cancelacion.js` | política de cancelación, reprogramación y reparto de reembolsos |
| `disponibilidad.js` | horarios libres (semanal, descansos, excepciones, vacaciones, bloqueos, buffer, aviso mínimo) |
| `reservas.js` | crear, pagar, confirmar, cancelar, reprogramar, cerrar; cola por especialista contra doble reserva |
| `pagos/` | orquestación, Mercado Pago y simulador |
| `liquidaciones.js` | liquidaciones para cobros "Alternativa cobra" y "Cobra el especialista" |
| `ranking.js`, `busqueda.js` | búsqueda en lenguaje natural, promedio bayesiano, perfiles nuevos intercalados, patrocinados |
| `especialistas.js` | alta, alta por administración, invitación y reclamo, cambios sensibles moderados, completitud |
| `resenas.js`, `mensajeria.js` | reseñas verificadas, respuestas, revisión; chat con ocultamiento de contacto |
| `notificaciones.js`, `email.js`, `webpush.js` | avisos por canal |
| `estadisticas.js` | visitas diarias y tableros (especialista y administración) |
| `automatizacion.js` | vencer impagas, conciliar, recordatorios, cierre automático, pedir reseñas, volver a reservar, destacados y promociones |
| `ajustes.js`, `formularios.js`, `multimedia.js`, `menu.js`, `iconos.js`, `fechas.js`, `util.js` | apoyo |

## Decisiones técnicas clave

### Evitar doble reserva

1. La pantalla muestra horarios libres, pero **el backend vuelve a calcular la disponibilidad** al confirmar.
2. Las reservas de un mismo especialista se procesan **en cola** (`reservas.enCola`): la verificación y el guardado no se intercalan aunque lleguen dos pedidos a la vez.
3. Las reservas impagas bloquean el horario `minutosParaPagar` (20 por defecto); la tarea automática las vence y libera el horario.

### Histórico inmutable

La reserva guarda una **fotografía** (`foto`) de los datos contractuales: precio, recargo, descuento, total, comisión (tasa, regla e importe), neto del especialista, costo estimado de la pasarela, duración, modelo de cobro, nombres y la política de cancelación vigente. Cambiar precios o reglas no altera reservas anteriores.

### Zona horaria

Todo se guarda en UTC y se interpreta en `America/Montevideo` con `Intl` (`services/fechas.js`), sin depender de la zona del servidor.

### Datos de prueba

`scripts/seed.js` genera todo relativo a la fecha de hoy y con una semilla fija (mismos datos cada vez): 57 usuarios, 21 especialistas, 43 servicios, ~380 reservas con pagos, reembolsos y reseñas, estadísticas de 60 días, contenidos, y un caso preparado para cada pantalla (ver `docs/pantallas.md`). Las imágenes de `public/img/demo` son ilustraciones propias.

### Seguridad

- Contraseñas con scrypt, bloqueo de 15 minutos tras 8 intentos fallidos, mensajes que no revelan si un email existe.
- Sesión regenerada al ingresar; cookie `httpOnly`, `sameSite=lax`, `secure` en producción.
- CSRF en todos los formularios (incluidos los de archivos) y en las llamadas `fetch`.
- Roles verificados en cada ruta y cada recurso validado contra su dueño.
- Límite de intentos en ingreso, reservas, contacto y denuncias.
- Cabeceras de seguridad con CSP (solo se permite embeber Google Maps), HSTS y redirección a HTTPS en producción.
- Archivos validados por tipo y tamaño; si la operación falla se borran. Documentos privados solo para el dueño y administración, con registro de cada apertura.
- Tokens de Mercado Pago cifrados con AES-256-GCM.
- Auditoría de solo inserción para acciones sensibles (quién, qué, cuándo, antes y después).

### Privacidad

Datos públicos mínimos: nombre + inicial en reseñas; dirección exacta solo con reserva; teléfonos y WhatsApp según la política de contacto; exportación y eliminación de cuenta desde `/mi/privacidad`.

### Paso a MongoDB

Los controladores solo hablan con los modelos. Para pasar a MongoDB se instala `mongoose`, se cargan `USAR_MONGO=true` y `MONGODB_URI`, y se reimplementan los métodos de `models/Modelo.js` (`todos`, `uno`, `porId`, `crear`, `actualizar`, `guardar`, `eliminar`, `contar`). Cada modelo documenta sus campos al principio del archivo.
