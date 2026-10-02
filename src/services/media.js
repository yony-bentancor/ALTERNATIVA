'use strict';
// Subida y validación de multimedia: tipo real del archivo, tamaño, cantidad y duración de video.
const { sniffMime, mp4DurationSeconds, imageSize } = require('../lib/files');
const { badRequest } = require('../lib/errors');
const { storage } = require('./storage');
const { getSettings } = require('./settings');

const IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED = {
  avatar: IMAGE, cover: IMAGE, photo: IMAGE, space: IMAGE, service: IMAGE, user_avatar: IMAGE, content: IMAGE,
  video: ['video/mp4', 'video/quicktime'],
  document: ['application/pdf', 'image/jpeg', 'image/png'],
};
const GALLERY_KINDS = ['photo', 'space', 'service'];

async function uploadMedia({ file, kind, specialist = null, owner = null, service = null, caption = '' }) {
  const { Media } = require('../models');
  if (!file || !file.buffer || !file.size) throw badRequest('No recibimos ningún archivo.');
  if (!ALLOWED[kind]) throw badRequest('Tipo de archivo no permitido.');
  const settings = await getSettings();
  const lim = settings.media;

  const mime = sniffMime(file.buffer);
  if (!mime || !ALLOWED[kind].includes(mime)) {
    const human = kind === 'video' ? 'MP4 o MOV' : kind === 'document' ? 'PDF, JPG o PNG' : 'JPG, PNG o WebP';
    throw badRequest(`Formato no válido. Usá ${human}.`);
  }

  const mb = file.size / (1024 * 1024);
  const maxMb = kind === 'video' ? lim.maxVideoMB : kind === 'document' ? lim.maxDocumentMB : lim.maxImageMB;
  if (mb > maxMb) throw badRequest(`El archivo pesa ${mb.toFixed(1)} MB. El máximo es ${maxMb} MB.`);

  let durationSec;
  if (kind === 'video') {
    durationSec = mp4DurationSeconds(file.buffer);
    if (!durationSec) throw badRequest('No pudimos leer la duración del video. Exportalo como MP4 (H.264).');
    if (durationSec > lim.maxVideoSeconds) throw badRequest(`El video dura ${Math.round(durationSec)} s. El máximo es ${lim.maxVideoSeconds} s.`);
  }
  let dims = null;
  if (IMAGE.includes(mime)) {
    dims = imageSize(file.buffer, mime);
    if (dims && (dims.width < 200 || dims.height < 200) && kind !== 'document') throw badRequest('La imagen es muy chica (mínimo 200 × 200 px).');
  }

  if (specialist && GALLERY_KINDS.includes(kind)) {
    const count = await Media.countDocuments({ specialist, kind: { $in: GALLERY_KINDS }, status: { $ne: 'rejected' } });
    if (count >= lim.maxPhotos) throw badRequest(`Alcanzaste el máximo de ${lim.maxPhotos} fotos. Borrá alguna para subir otra.`);
  }

  const isPrivate = kind === 'document';
  const folder = isPrivate ? 'documentos' : kind === 'video' ? 'videos' : kind === 'user_avatar' ? 'usuarios' : 'especialistas';
  const stored = await storage().save({ buffer: file.buffer, mime, folder, isPrivate });

  const needsReview = !isPrivate && settings.moderation.mediaRequiresReview && kind !== 'user_avatar' && kind !== 'content';
  const last = specialist ? await Media.findOne({ specialist, kind }).sort({ order: -1 }).select('order').lean() : null;

  return Media.create({
    specialist, owner, service, kind, caption: String(caption || '').slice(0, 200),
    url: stored.url, thumbUrl: stored.thumbUrl, storage: { driver: stored.driver, key: stored.key },
    mime, bytes: file.size, width: stored.width || dims?.width, height: stored.height || dims?.height,
    durationSec: stored.durationSec || durationSec,
    visibility: isPrivate ? 'private' : 'public',
    status: needsReview ? 'pending' : 'approved',
    order: (last?.order || 0) + 1,
  });
}

async function removeMedia(media) {
  const { Media, Specialist, Service } = require('../models');
  await storage().remove(media.storage?.key, { isPrivate: media.visibility === 'private' });
  await Media.deleteOne({ _id: media._id });
  if (media.specialist) {
    await Specialist.updateOne({ _id: media.specialist, avatar: media._id }, { $unset: { avatar: 1 } });
    await Specialist.updateOne({ _id: media.specialist, cover: media._id }, { $unset: { cover: 1 } });
    await Specialist.updateOne({ _id: media.specialist, video: media._id }, { $unset: { video: 1 } });
    await Service.updateMany({ specialist: media.specialist }, { $pull: { photos: media._id } });
  }
}

// Solo multimedia aprobada y pública se muestra en la ficha.
const publicFilter = (specialistId) => ({ specialist: specialistId, visibility: 'public', status: 'approved' });

module.exports = { uploadMedia, removeMedia, publicFilter, ALLOWED, GALLERY_KINDS };
