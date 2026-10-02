/* Menús laterales del panel del especialista y de administración (con contadores de pendientes). */

async function seccionesPanel(usuario, sinLeer = 0) {
  const { Reserva, Resena } = require("../models");
  const id = usuario.especialistaId;
  const porConfirmar = await Reserva.contar((r) => r.especialistaId === id && r.estado === "pagada");
  const sinResponder = await Resena.contar((r) => r.especialistaId === id && !r.respuesta && r.estado !== "oculta");
  return [
    { titulo: "Gestión", items: [["inicio", "/panel", "Inicio", "home"], ["agenda", "/panel/agenda", "Agenda", "calendar"], ["reservas", "/panel/reservas", "Reservas", "list", porConfirmar], ["clientes", "/panel/clientes", "Clientes", "users"], ["mensajes", "/panel/mensajes", "Mensajes", "chat", sinLeer]] },
    { titulo: "Mi ficha", items: [["perfil", "/panel/perfil", "Perfil", "user"], ["servicios", "/panel/servicios", "Servicios", "layers"], ["multimedia", "/panel/perfil/multimedia", "Fotos y video", "image"], ["resenas", "/panel/resenas", "Reseñas", "star", sinResponder], ["verificacion", "/panel/verificacion", "Verificación", "shield"]] },
    { titulo: "Negocio", items: [["estadisticas", "/panel/estadisticas", "Estadísticas", "chart"], ["ingresos", "/panel/ingresos", "Ingresos", "wallet"], ["promociones", "/panel/promociones", "Promociones", "tag"], ["destacados", "/panel/destacados", "Destacados", "megaphone"], ["plan", "/panel/plan", "Plan Profesional", "sparkle"]] },
    { titulo: "Cuenta", items: [["cobros", "/panel/cuenta/cobros", "Cobros", "card"], ["configuracion", "/panel/cuenta", "Configuración", "settings"], ["ayuda", "/panel/ayuda", "Ayuda", "help"]] },
  ];
}

async function seccionesAdmin() {
  const { Especialista, Verificacion, Denuncia, Consulta, Reembolso, Resena, Multimedia, Reserva } = require("../models");
  const pendientes = (await Especialista.contar((e) => e.estado === "en_revision" || (e.cambiosPendientes || []).length)) + (await Reserva.contar((r) => r.incidencia?.abierta));
  return [
    { titulo: "General", items: [["dashboard", "/admin", "Resumen", "home"], ["pendientes", "/admin/pendientes", "Pendientes", "bell", pendientes], ["estadisticas", "/admin/estadisticas", "Estadísticas", "chart"]] },
    { titulo: "Marketplace", items: [["especialistas", "/admin/especialistas", "Especialistas", "users"], ["usuarios", "/admin/usuarios", "Usuarios", "user"], ["servicios", "/admin/servicios", "Servicios", "layers"], ["categorias", "/admin/categorias", "Categorías", "grid"], ["reservas", "/admin/reservas", "Reservas", "calendar"], ["verificaciones", "/admin/verificaciones", "Verificaciones", "shield", await Verificacion.contar((v) => v.estado === "pendiente")]] },
    { titulo: "Dinero", items: [["pagos", "/admin/pagos", "Pagos", "card"], ["reembolsos", "/admin/reembolsos", "Reembolsos", "repeat", await Reembolso.contar((r) => r.estado === "fallido")], ["liquidaciones", "/admin/liquidaciones", "Liquidaciones", "wallet"], ["comisiones", "/admin/comisiones", "Comisiones", "receipt"]] },
    { titulo: "Confianza", items: [["resenas", "/admin/resenas", "Reseñas", "star", await Resena.contar((r) => r.estado === "en_revision")], ["moderacion", "/admin/moderacion", "Moderación", "eye", await Multimedia.contar((m) => ["pendiente", "reportado"].includes(m.estado))], ["denuncias", "/admin/denuncias", "Denuncias", "flag", await Denuncia.contar((d) => d.estado === "abierta")], ["soporte", "/admin/soporte", "Soporte", "help", await Consulta.contar((t) => t.estado === "abierta")]] },
    { titulo: "Crecimiento", items: [["destacados", "/admin/destacados", "Destacados", "megaphone"], ["promociones", "/admin/promociones", "Promociones", "tag"], ["contenido", "/admin/contenido", "Contenido", "file"], ["notificaciones", "/admin/notificaciones", "Avisos", "send"]] },
    { titulo: "Sistema", items: [["configuracion", "/admin/configuracion", "Configuración", "settings"], ["auditoria", "/admin/auditoria", "Auditoría", "lock"]] },
  ];
}

/** Primera pantalla según el rol. */
function inicioDe(u) {
  if (u.rol === "admin") return "/admin";
  if (u.especialistaId) return "/panel";
  return "/mi";
}

module.exports = { seccionesPanel, seccionesAdmin, inicioDe };
