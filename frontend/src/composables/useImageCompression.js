// Composable pour redimensionner et compresser une image côté client.
// Utilisé dans la modale de génération FAQ (Partie 1.A) pour limiter le coût
// Claude Vision : ~1500 tokens / image, on cap à 1600px de largeur en WebP 0.85.

const MAX_WIDTH = 1600
const QUALITY = 0.85

async function _drawableFromFile(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file) } catch { /* fallback img */ }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = (e) => reject(e)
    img.src = URL.createObjectURL(file)
  })
}

function _canvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

function _toBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type, quality })
  }
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Compresse une image en redimensionnant à `maxWidth` max et en réencodant
 * en WebP qualité `quality`. Retourne :
 *   { file, width, height, originalSize, compressedSize, dataUrl }
 */
export async function compressImage(file, { maxWidth = MAX_WIDTH, quality = QUALITY } = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    throw new Error('Fichier non image')
  }
  // GIF : pas de compression (animations cassées par canvas)
  if (file.type === 'image/gif') {
    return {
      file,
      width: null,
      height: null,
      originalSize: file.size,
      compressedSize: file.size,
      dataUrl: await _readAsDataUrl(file),
    }
  }
  const drawable = await _drawableFromFile(file)
  const srcW = drawable.width
  const srcH = drawable.height
  const ratio = srcW > maxWidth ? maxWidth / srcW : 1
  const w = Math.round(srcW * ratio)
  const h = Math.round(srcH * ratio)
  const canvas = _canvas(w, h)
  canvas.getContext('2d').drawImage(drawable, 0, 0, w, h)
  const blob = await _toBlob(canvas, 'image/webp', quality)
  if (!blob) throw new Error('Échec encodage WebP')
  const compressedFile = new File(
    [blob],
    file.name.replace(/\.[^.]+$/, '.webp'),
    { type: 'image/webp' },
  )
  return {
    file: compressedFile,
    width: w,
    height: h,
    originalSize: file.size,
    compressedSize: compressedFile.size,
    dataUrl: await _readAsDataUrl(compressedFile),
  }
}

function _readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = (e) => reject(e)
    r.readAsDataURL(blob)
  })
}

// Estimation très approximative du coût Claude Vision pour N images.
// Sonnet 4.6 input ≈ $3 / 1M tokens. On compte 1500 tokens / image (résolution standard).
// Le prompt système est en cache donc négligé.
export function estimateVisionCost(imageCount) {
  const tokensPerImage = 1500
  const totalTokens = imageCount * tokensPerImage
  const usd = (totalTokens / 1_000_000) * 3
  const eur = usd * 0.93
  return { tokens: totalTokens, eur: Math.round(eur * 1000) / 1000 }
}
