'use strict';
// Crea (o promueve) la cuenta de administración. Uso:
//   ADMIN_EMAIL=vos@dominio.uy ADMIN_PASSWORD='algo-largo-1' npm run create-admin
const db = require('../src/config/db');
const config = require('../src/config');

(async () => {
  const email = (process.argv[2] || config.admin.email || '').toLowerCase().trim();
  const password = process.argv[3] || config.admin.password;
  if (!email || !password) {
    console.error('Indicá ADMIN_EMAIL y ADMIN_PASSWORD (o pasalos como argumentos).');
    process.exit(1);
  }
  try {
    await db.connect();
    const { User } = require('../src/models');
    const { hashPassword, passwordProblems } = require('../src/services/auth');
    const problem = passwordProblems(password);
    if (problem) throw new Error(problem);
    let user = await User.findOne({ email });
    if (user) {
      user.role = 'admin';
      user.passwordHash = await hashPassword(password);
      user.status = 'active';
      await user.save();
      console.log(`Cuenta existente promovida a administrador: ${email}`);
    } else {
      user = await User.create({ name: 'Administración', email, role: 'admin', passwordHash: await hashPassword(password), emailVerified: true, acceptedTermsAt: new Date() });
      console.log(`Administrador creado: ${email}`);
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await db.disconnect().catch(() => {});
  }
})();
