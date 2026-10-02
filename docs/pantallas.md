# Mapa de pantallas

Las 129 pantallas funcionales del documento maestro y dónde están. Algunas son vistas, pestañas o estados de una misma URL (como preveía el documento).

## Públicas (1–25)

| # | Pantalla | URL |
|---|---|---|
| 1 | Home | `/` |
| 2 | Buscar | `/buscar` |
| 3 | Resultados de búsqueda | `/buscar?q=…` |
| 4 | Filtros | `/buscar` → "Filtros" (departamento, modalidad, cuándo, precio, valoración, verificados, cerca de mí) |
| 5 | Categorías | `/categorias` |
| 6 | Categoría individual | `/masajes`, `/acupuntura`, … (`/:slug`) |
| 7 | Perfil público de especialista | `/especialistas/:slug` |
| 8 | Detalle de servicio | `/servicios/:especialista/:servicio` |
| 9 | Reseñas del servicio | `/servicios/:especialista/:servicio/resenas` |
| 10 | Galería | `/especialistas/:slug/galeria` |
| 11 | Cómo funciona | `/como-funciona` |
| 12 | Sobre Alternativa | `/sobre-alternativa` |
| 13 | Preguntas frecuentes | `/preguntas-frecuentes` |
| 14 | Contacto | `/contacto` |
| 15 | Blog | `/blog` |
| 16 | Artículo | `/blog/:slug` |
| 17 | Términos y condiciones | `/terminos` |
| 18 | Política de privacidad | `/privacidad` |
| 19 | Política de cancelaciones | `/cancelaciones` |
| 20 | Registro | `/registro?tipo=usuario` / `?tipo=especialista` |
| 21 | Selección de tipo de cuenta | `/registro` |
| 22 | Login | `/login` |
| 23 | Recuperar contraseña | `/recuperar` |
| 24 | Restablecer contraseña | `/restablecer/:token` |
| 25 | Verificación de cuenta | `/verificar/:token` (+ reenvío desde Mi cuenta) |

Extra: `/ofrecer` (landing para especialistas), `/reclamar/:token` (reclamo de perfil), `/sitemap.xml`, `/robots.txt`.

## Usuario (26–55)

| # | Pantalla | URL |
|---|---|---|
| 26 | Inicio usuario | `/mi` |
| 27–31 | Buscar, resultados, filtros, perfil, servicio | mismas URLs públicas, con favoritos y próximas reservas |
| 32 | Selección de fecha | `/reservar/:servicio` (calendario) |
| 33 | Selección de hora | `/reservar/:servicio` (horarios del día) |
| 34 | Confirmación de reserva | `/reservar/:servicio/confirmar?fecha&hora&modalidad` |
| 35 | Pago | `/pago/:reserva` → Mercado Pago |
| 36 | Resultado del pago | `/pago/retorno` |
| 37 | Reserva confirmada | `/mi/reservas/:id?nueva=1` |
| 38 | Mis reservas | `/mi/reservas` |
| 39 | Próximas | `/mi/reservas` (pestaña Próximas) |
| 40 | Historial | `/mi/reservas?tab=historial` |
| 41 | Detalle de reserva | `/mi/reservas/:id` (+ `.ics` para el calendario) |
| 42 | Reprogramar | `/mi/reservas/:id/reprogramar` |
| 43 | Cancelar | `/mi/reservas/:id/cancelar` (muestra el reembolso antes de confirmar) |
| 44 | Valorar servicio | `/mi/reservas/:id/valorar` |
| 45 | Escribir reseña | `/mi/reservas/:id/valorar`, editar en `/mi/resenas/:id/editar` |
| 46 | Favoritos | `/mi/favoritos` |
| 47 | Mensajes | `/mi/mensajes` |
| 48 | Conversación | `/mi/mensajes/:id` |
| 49 | Notificaciones | `/mi/notificaciones` |
| 50 | Perfil personal | `/mi/perfil` |
| 51 | Editar perfil | `/mi/perfil/editar` |
| 52 | Métodos de pago | `/mi/metodos-de-pago` (+ historial en `/mi/pagos`) |
| 53 | Configuración | `/mi/configuracion` |
| 54 | Privacidad | `/mi/privacidad` (exportar datos, eliminar cuenta) |
| 55 | Ayuda / soporte | `/mi/ayuda`, `/mi/ayuda/:id` |

Extra: volver a reservar `/mi/reservas/:id/volver`, reportar problema en el detalle, mis reseñas `/mi/resenas`.

## Especialista (56–94)

| # | Pantalla | URL |
|---|---|---|
| 56 | Dashboard | `/panel` |
| 57 | Mi perfil | `/panel/perfil` |
| 58 | Editar perfil | `/panel/perfil/editar` (+ apariencia `/panel/perfil/apariencia`) |
| 59 | Vista pública | `/especialistas/:slug` (vista previa si no está publicada) |
| 60 | Multimedia | `/panel/perfil/multimedia` |
| 61 | Subir fotografía | `/panel/perfil/multimedia/subir?tipo=foto` |
| 62 | Subir video | `/panel/perfil/multimedia/subir?tipo=video` |
| 63 | Servicios | `/panel/servicios` |
| 64 | Crear servicio | `/panel/servicios/nuevo` |
| 65 | Editar servicio | `/panel/servicios/:id/editar` |
| 66 | Detalle de servicio | `/panel/servicios/:id` |
| 67 | Disponibilidad | `/panel/agenda/disponibilidad` |
| 68 | Agenda diaria | `/panel/agenda?vista=dia` |
| 69 | Agenda semanal | `/panel/agenda?vista=semana` |
| 70 | Agenda mensual | `/panel/agenda?vista=mes` |
| 71 | Configurar horarios | `/panel/agenda/horarios` |
| 72 | Bloquear horario/día | `/panel/agenda/bloqueos` (día, horario, vacaciones, horario especial, descansos) |
| 73 | Reservas | `/panel/reservas` |
| 74 | Detalle de reserva | `/panel/reservas/:id` |
| 75 | Próximas reservas | `/panel/reservas` (Próximas / Por confirmar) |
| 76 | Historial | `/panel/reservas?tab=historial` |
| 77 | Clientes | `/panel/clientes` |
| 78 | Detalle de cliente | `/panel/clientes/:id` |
| 79 | Mensajes | `/panel/mensajes`, `/panel/mensajes/:id` |
| 80 | Estadísticas | `/panel/estadisticas` |
| 81 | Ingresos | `/panel/ingresos` |
| 82 | Visualizaciones | `/panel/visualizaciones` |
| 83 | Rendimiento por servicio | `/panel/rendimiento` |
| 84 | Reseñas | `/panel/resenas` |
| 85 | Responder reseña | `/panel/resenas` (responder / pedir revisión) |
| 86 | Notificaciones | `/panel/notificaciones` |
| 87 | Verificación | `/panel/verificacion` |
| 88 | Certificaciones / documentación | `/panel/certificaciones` |
| 89 | Configuración de cuenta | `/panel/cuenta` (+ cobros `/panel/cuenta/cobros`) |
| 90 | Ayuda | `/panel/ayuda` |
| 91 | Promociones | `/panel/promociones` |
| 92 | Destacados / publicidad | `/panel/destacados` |
| 93 | Plan profesional | `/panel/plan` |
| 94 | Facturación / suscripción | `/panel/facturacion` |

Extra: alta `/panel/comenzar`, menú móvil `/panel/mas`.

## Administración (95–129)

| # | Pantalla | URL |
|---|---|---|
| 95 | Login administración | `/admin/login` → `/login` |
| 96 | Dashboard general | `/admin` |
| 97 | Especialistas | `/admin/especialistas` |
| 98 | Crear especialista | `/admin/especialistas/nuevo` |
| 99 | Editar especialista | `/admin/especialistas/:id/editar` |
| 100 | Detalle especialista | `/admin/especialistas/:id` |
| 101 | Verificación | `/admin/verificaciones` |
| 102 | Solicitudes pendientes | `/admin/pendientes` |
| 103 | Usuarios | `/admin/usuarios` |
| 104 | Detalle usuario | `/admin/usuarios/:id` |
| 105 | Servicios | `/admin/servicios`, `/admin/servicios/:id` |
| 106 | Categorías | `/admin/categorias` |
| 107 | Crear/editar categoría | `/admin/categorias/nueva`, `/admin/categorias/:id` |
| 108 | Reservas | `/admin/reservas` |
| 109 | Detalle reserva | `/admin/reservas/:id` |
| 110 | Pagos | `/admin/pagos`, `/admin/pagos/:id` |
| 111 | Comisiones | `/admin/comisiones` |
| 112 | Reembolsos | `/admin/reembolsos` |
| 113 | Liquidaciones | `/admin/liquidaciones` |
| 114 | Reseñas | `/admin/resenas` |
| 115 | Moderación | `/admin/moderacion` |
| 116 | Reportes / denuncias | `/admin/denuncias` |
| 117 | Multimedia reportada | `/admin/moderacion?tab=reportada` |
| 118 | Destacados / publicidad | `/admin/destacados` |
| 119 | Promociones | `/admin/promociones` |
| 120 | Estadísticas | `/admin/estadisticas` |
| 121 | Configuración de comisiones | `/admin/comisiones` + `/admin/configuracion?seccion=commission` |
| 122 | Configuración general | `/admin/configuracion` |
| 123 | Notificaciones | `/admin/notificaciones` |
| 124 | Gestión de contenido | `/admin/contenido` |
| 125 | Blog | `/admin/contenido?tipo=post` |
| 126 | FAQ | `/admin/contenido?tipo=faq` |
| 127 | Términos | `/admin/contenido?tipo=page` → `terminos` |
| 128 | Logs / auditoría | `/admin/auditoria` |
| 129 | Soporte / incidencias | `/admin/soporte`, `/admin/soporte/:id` |
