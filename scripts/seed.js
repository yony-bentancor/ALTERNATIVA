'use strict';
// Datos iniciales. Idempotente: se puede correr varias veces.
//   npm run seed            → categorías, contenido institucional y FAQ (seguro en producción)
//   npm run seed -- --demo  → además, especialistas, servicios, usuario y reseñas de ejemplo (solo desarrollo/staging)
const db = require('../src/config/db');
const config = require('../src/config');
const defaults = require('../src/views/defaultContent');

const CATEGORIES = [
  { name: 'Masajes', slug: 'masajes', icon: 'hands', color: '#3B82F6', description: 'Relajantes, descontracturantes, deportivos y terapéuticos.', featured: true },
  { name: 'Acupuntura', slug: 'acupuntura', icon: 'needle', color: '#0EA5E9', description: 'Medicina tradicional china con especialistas formados.', featured: true },
  { name: 'Yoga', slug: 'yoga', icon: 'lotus', color: '#8B5CF6', description: 'Clases individuales y grupales, presenciales u online.', featured: true },
  { name: 'Tai Chi', slug: 'tai-chi', icon: 'yinyang', color: '#14B8A6', description: 'Movimiento consciente para el equilibrio y la calma.' },
  { name: 'Reiki', slug: 'reiki', icon: 'sparkle', color: '#F59E0B', description: 'Sesiones de armonización energética.', featured: true },
  { name: 'Astrología', slug: 'astrologia', icon: 'moon', color: '#6366F1', description: 'Cartas astrales, revolución solar y consultas.' },
  { name: 'Terapias con imanes', slug: 'terapias-con-imanes', icon: 'magnet', color: '#EC4899', description: 'Biomagnetismo y terapias afines.' },
  { name: 'Meditación', slug: 'meditacion', icon: 'breath', color: '#10B981', description: 'Guías, cursos y prácticas para aprender a meditar.' },
];

const DEMO = [
  {
    name: 'Laura Martínez', email: 'laura@demo.alternativa.uy', headline: 'Masajista terapéutica con 10 años de experiencia', cats: ['masajes'], dept: 'Montevideo', city: 'Montevideo', hood: 'Pocitos', geo: [-56.1504, -34.9145], mods: ['presencial', 'domicilio'],
    services: [['Masaje relajante', 1000, 60, 'masajes'], ['Masaje descontracturante', 1200, 60, 'masajes'], ['Reflexología', 900, 45, 'masajes']],
  },
  {
    name: 'Martín Suárez', email: 'martin@demo.alternativa.uy', headline: 'Acupuntor formado en medicina tradicional china', cats: ['acupuntura'], dept: 'Montevideo', city: 'Montevideo', hood: 'Cordón', geo: [-56.1802, -34.9038], mods: ['presencial'],
    services: [['Sesión de acupuntura', 1400, 50, 'acupuntura'], ['Acupuntura para el estrés', 1500, 60, 'acupuntura']],
  },
  {
    name: 'Sofía Pereira', email: 'sofia@demo.alternativa.uy', headline: 'Profesora de yoga y meditación', cats: ['yoga', 'meditacion'], dept: 'Canelones', city: 'Ciudad de la Costa', hood: 'Shangrilá', geo: [-55.9886, -34.8508], mods: ['presencial', 'online'],
    services: [['Clase de yoga individual', 800, 60, 'yoga'], ['Meditación guiada online', 600, 45, 'meditacion']],
  },
  {
    name: 'Valentina Rodríguez', email: 'valentina@demo.alternativa.uy', headline: 'Reiki usui nivel III', cats: ['reiki'], dept: 'Maldonado', city: 'Punta del Este', hood: 'Península', geo: [-54.9500, -34.9620], mods: ['presencial', 'online'],
    services: [['Sesión de reiki', 1100, 60, 'reiki']],
  },
];

async function upsertCategories(Category) {
  for (const [i, c] of CATEGORIES.entries()) {
    await Category.updateOne({ slug: c.slug }, { $setOnInsert: { ...c, status: 'active', order: i } }, { upsert: true });
  }
}

async function upsertContent(Content) {
  for (const [slug, page] of Object.entries(defaults.pages)) {
    await Content.updateOne({ type: 'page', slug }, { $setOnInsert: { type: 'page', slug, title: page.title, excerpt: page.excerpt, body: page.body, status: 'published', publishedAt: new Date() } }, { upsert: true });
  }
  if (!(await Content.exists({ type: 'faq' }))) {
    await Content.insertMany(defaults.faqs.map((f, i) => ({ type: 'faq', title: f.title, body: f.body, category: f.category, order: i, status: 'published', publishedAt: new Date() })));
  }
  if (!(await Content.exists({ type: 'post' }))) {
    await Content.create({
      type: 'post', slug: 'como-elegir-masajista', title: 'Cómo elegir masajista: 5 cosas para mirar antes de reservar', category: 'Guías', tags: ['masajes'], status: 'published', publishedAt: new Date(),
      excerpt: 'Reseñas del servicio específico, formación verificada y modalidad: lo que conviene revisar.',
      body: '## 1. Mirá la reputación del servicio, no solo de la persona\n\nEn Alternativa cada servicio tiene su propia valoración. Si buscás un masaje deportivo, fijate en las reseñas de ese servicio.\n\n## 2. Verificado y declarado no son lo mismo\n\nEl sello “Certificación verificada” significa que revisamos el documento. Lo demás es información que declara el especialista.\n\n## 3. Elegí la modalidad\n\nConsultorio, a domicilio u online: cada una tiene su precio y su logística.\n\n## 4. Leé la política de cancelación\n\nLa ves antes de pagar y queda guardada en tu reserva.\n\n## 5. Escribí antes si tenés dudas\n\nDesde la ficha podés mandar un mensaje antes de reservar.',
    });
  }
}

async function seedDemo(M) {
  const { hashPassword } = require('../src/services/auth');
  const { syncSearchForSpecialist, recomputeServiceRating, recomputeSpecialistStats } = require('../src/services/specialists');
  const { slugify } = require('../src/lib/slug');
  const cats = new Map((await M.Category.find({}).lean()).map((c) => [c.slug, c]));
  const password = await hashPassword('demo1234');

  const client = await M.User.findOneAndUpdate(
    { email: 'cliente@demo.alternativa.uy' },
    { $setOnInsert: { name: 'Camila Demo', passwordHash: password, emailVerified: true, phone: '099 000 000', acceptedTermsAt: new Date() } },
    { upsert: true, new: true },
  );

  for (const [idx, d] of DEMO.entries()) {
    const user = await M.User.findOneAndUpdate(
      { email: d.email },
      { $setOnInsert: { name: d.name, passwordHash: password, emailVerified: true, role: 'specialist', acceptedTermsAt: new Date() } },
      { upsert: true, new: true },
    );
    let sp = await M.Specialist.findOne({ user: user._id });
    if (!sp) {
      sp = await M.Specialist.create({
        user: user._id, slug: slugify(d.name), displayName: d.name, headline: d.headline,
        bio: `Hola, soy ${d.name.split(' ')[0]}. Acompaño a personas que buscan sentirse mejor con sesiones a medida, con escucha y respeto por los tiempos de cada uno. Trabajo con turnos puntuales y un espacio cuidado.`,
        yearsOfExperience: 5 + idx * 2, categories: d.cats.map((c) => cats.get(c)._id), modalities: d.mods,
        location: { department: d.dept, city: d.city, neighborhood: d.hood, address: 'Dirección de ejemplo 1234', addressPublicHint: d.hood, geo: { type: 'Point', coordinates: d.geo }, serviceRadiusKm: 10 },
        status: 'active', publishedAt: new Date(Date.now() - (idx === 3 ? 10 : 200) * 86400000),
        verification: { identity: { status: idx < 2 ? 'verified' : 'none', at: new Date() } },
        claim: { status: 'self' },
        mercadopago: { userId: 'SIMULADO', connectedAt: new Date() },
      });
      await M.User.updateOne({ _id: user._id }, { $set: { specialist: sp._id } });
      await M.Availability.create({ specialist: sp._id });
      for (const [i, [title, price, duration, cat]] of d.services.entries()) {
        await M.Service.create({
          specialist: sp._id, category: cats.get(cat)._id, slug: slugify(title), title, price, durationMinutes: duration, order: i,
          summary: `${title} con ${d.name.split(' ')[0]}.`, description: 'Sesión personalizada. Antes de empezar conversamos sobre lo que necesitás.',
          modalities: d.mods, homeServiceExtra: d.mods.includes('domicilio') ? 250 : 0, status: 'active',
        });
      }
    }
    await syncSearchForSpecialist(sp._id);

    // Reseñas verificadas de ejemplo (con reservas realizadas reales en la base)
    const services = await M.Service.find({ specialist: sp._id }).lean();
    const ratings = idx === 3 ? [] : [5, 5, 4, 5, 4];
    for (const [i, rating] of ratings.entries()) {
      const svc = services[i % services.length];
      const code = `DEMO-${idx}${i}`;
      if (await M.Booking.exists({ code })) continue;
      const start = new Date(Date.now() - (10 + i * 7) * 86400000);
      const booking = await M.Booking.create({
        code, user: client._id, specialist: sp._id, service: svc._id,
        snapshot: { serviceTitle: svc.title, serviceSlug: svc.slug, specialistName: d.name, specialistSlug: sp.slug, userName: client.name, price: svc.price, subtotal: svc.price, total: Math.round(svc.price * 1.05), commissionRate: 5, commissionAmount: Math.round(svc.price * 0.05), specialistNet: svc.price, specialistReceives: svc.price, durationMinutes: svc.durationMinutes, collectionModel: 'split', feeMode: 'added', currency: 'UYU' },
        start, end: new Date(start.getTime() + svc.durationMinutes * 60000), modality: d.mods[0], status: 'completed', completedAt: start, reviewed: true, isFirstWithSpecialist: i === 0,
        history: [{ status: 'completed', byRole: 'system', note: 'Dato de ejemplo' }],
      });
      await M.Review.create({ booking: booking._id, service: svc._id, specialist: sp._id, user: client._id, authorName: 'Camila D.', rating, comment: rating === 5 ? 'Excelente atención, muy profesional. Volvería.' : 'Muy buena sesión, puntual y cuidadosa.', serviceDate: start });
    }
    for (const svc of services) await recomputeServiceRating(svc._id);
    await recomputeSpecialistStats(sp._id);
    await syncSearchForSpecialist(sp._id);
  }
  console.log('Demo listo. Usuarios: cliente@demo.alternativa.uy / laura@demo.alternativa.uy (contraseña: demo1234)');
}

(async () => {
  try {
    await db.connect();
    const M = require('../src/models');
    await upsertCategories(M.Category);
    await upsertContent(M.Content);
    const { refreshCategoryCounts } = require('../src/services/specialists');
    if (process.argv.includes('--demo')) {
      if (config.isLive) throw new Error('No se cargan datos de ejemplo en producción.');
      await seedDemo(M);
    }
    await refreshCategoryCounts();
    console.log('Seed completo.');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await db.disconnect().catch(() => {});
  }
})();
