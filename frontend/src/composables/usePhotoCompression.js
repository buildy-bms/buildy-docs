/**
 * Compression d'image côté client pour économiser le réseau 4G.
 *
 * - Si le fichier est < SKIP_THRESHOLD ou pas une image bitmap supportée
 *   par createImageBitmap, on retourne le fichier original (le serveur
 *   Sharp prend le relais — il sait gérer HEIC/HEIF).
 * - Sinon : décodage via createImageBitmap → canvas redimensionné → JPEG.
 * - Cible : ~600 KB pour un côté max de 2400px à qualité 0.82.
 *
 * Le composant appelant attend un Blob ou File en sortie, utilisable
 * directement dans un FormData.
 *
 * `extractExifMeta(file)` doit être appelé AVANT compressBeforeUpload :
 * la passe canvas re-encode et strip l'EXIF, donc l'EXIF doit être
 * extrait sur le file original puis transmis au backend en query params.
 */

import exifr from 'exifr'

const SKIP_THRESHOLD = 1024 * 1024 // 1 MB
const HEIC_MIMES = new Set(['image/heic', 'image/heif'])

export function usePhotoCompression() {
  return { compressBeforeUpload, extractExifMeta }
}

export async function extractExifMeta(file) {
  if (!file || !file.type?.startsWith('image/')) return null
  try {
    const data = await exifr.parse(file, {
      pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate',
             'GPSLatitude', 'GPSLongitude', 'latitude', 'longitude',
             'Make', 'Model'],
      reviveValues: true,
    })
    if (!data) return null
    const meta = {}
    const dt = data.DateTimeOriginal || data.CreateDate || data.ModifyDate
    if (dt instanceof Date && !isNaN(dt.getTime())) meta.taken_at = dt.toISOString()
    if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
      meta.gps_latitude = data.latitude
      meta.gps_longitude = data.longitude
    }
    if (typeof data.Make === 'string' && data.Make.trim())   meta.camera_make = data.Make.trim()
    if (typeof data.Model === 'string' && data.Model.trim()) meta.camera_model = data.Model.trim()
    return Object.keys(meta).length ? meta : null
  } catch {
    return null
  }
}

export async function compressBeforeUpload(file, opts = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) return file
  if (file.size <= SKIP_THRESHOLD) return file
  // HEIC/HEIF : pas pris en charge par createImageBitmap dans tous les Safari iOS
  // → laisse le serveur Sharp s'en occuper, même si gros.
  if (HEIC_MIMES.has(file.type)) return file

  const maxDim = opts.maxDim || 2400
  const quality = opts.quality ?? 0.82

  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = bitmap
    const longest = Math.max(width, height)
    const scale = longest > maxDim ? maxDim / longest : 1
    const targetW = Math.round(width * scale)
    const targetH = Math.round(height * scale)

    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(targetW, targetH)
      : Object.assign(document.createElement('canvas'), { width: targetW, height: targetH })
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, targetW, targetH)
    bitmap.close?.()

    const blob = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: 'image/jpeg', quality })
      : await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))

    if (!blob || blob.size >= file.size) {
      // Compression a échoué ou n'apporte rien — garde l'original.
      return file
    }

    // Renomme le fichier en .jpg pour que le backend détecte bien le format
    const baseName = (file.name || 'photo').replace(/\.[^.]+$/, '')
    return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: file.lastModified || Date.now() })
  } catch {
    // En cas d'échec (codec non supporté, mémoire, etc), on retombe sur l'original.
    return file
  }
}
