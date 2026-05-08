<script setup>
/**
 * Éditeur d'annotations Cleanshot-like sur une capture d'écran.
 * Outils : sélection, flèche, rectangle, ellipse, pastille numérotée,
 * spotlight, flou (manuel + auto PII), texte, undo/redo.
 *
 * À la validation, on flatten le canvas en PNG et on retourne un Blob.
 *
 * Lib : Konva.js + vue-konva (~150 KB total).
 */
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import {
  CursorArrowRaysIcon, ArrowRightIcon, Square2StackIcon,
  EllipsisHorizontalCircleIcon, NumberedListIcon, SunIcon, EyeSlashIcon,
  ChatBubbleBottomCenterTextIcon as TextIcon,
  ArrowUturnLeftIcon, ArrowUturnRightIcon,
  CheckIcon, XMarkIcon, ShieldCheckIcon, ArrowPathIcon,
} from '@heroicons/vue/24/outline'
import BaseModal from '@/components/BaseModal.vue'
import { useNotification } from '@/composables/useNotification'
import { detectPii } from '@/composables/usePiiBlur'

const props = defineProps({
  imageBlob: { type: Blob, required: true },     // Blob image source à annoter
  initialAnnotated: { type: Blob, default: null }, // Si déjà annoté précédemment, on ouvre cette image
})
const emit = defineEmits(['close', 'save'])
const { success, error: notifyError } = useNotification()

// ── État Konva ──────────────────────────────────────────────────────
const stageRef = ref(null)         // ref vers <Stage>
const containerRef = ref(null)     // div parent pour calcul de taille
const Konva = ref(null)            // import dynamique
const stage = ref(null)            // Konva.Stage
const imageLayer = ref(null)
const blurLayer = ref(null)
const annoLayer = ref(null)
const transformer = ref(null)
const imageNode = ref(null)
const dims = ref({ w: 800, h: 600 })

// ── Outils + état ────────────────────────────────────────────────────
const tool = ref('select')          // 'select' | 'arrow' | 'rect' | 'ellipse' | 'pin' | 'spotlight' | 'blur' | 'text'
const color = ref('#ef4444')        // rouge par défaut
const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#6366f1', '#ffffff', '#111827']
const pinCounter = ref(1)           // numérotation auto des pastilles
const isDrawing = ref(false)
const drawStart = ref(null)
const currentNode = ref(null)

// Historique pour undo/redo : pile JSON des shapes du annoLayer + blurLayer
const history = ref([])
const historyIdx = ref(-1)

const piiRunning = ref(false)

// ── Init Konva ──────────────────────────────────────────────────────
async function initKonva() {
  const mod = await import('konva')
  Konva.value = mod.default || mod

  const container = containerRef.value
  if (!container) return

  // Charger l'image source pour connaître ses dimensions originales
  const sourceBlob = props.initialAnnotated || props.imageBlob
  const url = URL.createObjectURL(sourceBlob)
  const img = await new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = reject
    im.src = url
  })

  // Ajuster la taille du stage pour fit dans la modale (~ 90% du viewport)
  const maxW = Math.min(container.clientWidth || 1100, window.innerWidth - 360)
  const maxH = window.innerHeight - 220
  const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1)
  const w = Math.round(img.naturalWidth * ratio)
  const h = Math.round(img.naturalHeight * ratio)
  dims.value = { w, h }

  await nextTick()

  stage.value = new Konva.value.Stage({
    container: stageRef.value,
    width: w,
    height: h,
  })
  imageLayer.value = new Konva.value.Layer()
  blurLayer.value = new Konva.value.Layer()
  annoLayer.value = new Konva.value.Layer()
  stage.value.add(imageLayer.value, blurLayer.value, annoLayer.value)

  imageNode.value = new Konva.value.Image({
    image: img,
    x: 0, y: 0, width: w, height: h,
    listening: false,
  })
  imageLayer.value.add(imageNode.value)
  imageLayer.value.draw()

  transformer.value = new Konva.value.Transformer({
    rotateEnabled: false,
    enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
  })
  annoLayer.value.add(transformer.value)

  // Listeners de dessin
  stage.value.on('mousedown touchstart', onStagePointerDown)
  stage.value.on('mousemove touchmove', onStagePointerMove)
  stage.value.on('mouseup touchend', onStagePointerUp)
  stage.value.on('click tap', onStageClick)

  pushHistory()  // état initial
  URL.revokeObjectURL(url)
}

onMounted(initKonva)
onBeforeUnmount(() => {
  if (stage.value) stage.value.destroy()
})

// ── Helpers shapes ──────────────────────────────────────────────────
function cursorXY() {
  const p = stage.value.getPointerPosition()
  return { x: p.x, y: p.y }
}

function makeArrow(x, y) {
  return new Konva.value.Arrow({
    points: [x, y, x, y],
    pointerLength: 14,
    pointerWidth: 14,
    fill: color.value,
    stroke: color.value,
    strokeWidth: 4,
    draggable: true,
  })
}
function makeRect(x, y) {
  return new Konva.value.Rect({
    x, y, width: 0, height: 0,
    stroke: color.value, strokeWidth: 3, draggable: true,
  })
}
function makeEllipse(x, y) {
  return new Konva.value.Ellipse({
    x, y, radiusX: 0, radiusY: 0,
    stroke: color.value, strokeWidth: 3, draggable: true,
  })
}
function makePin(x, y) {
  const group = new Konva.value.Group({ x, y, draggable: true })
  const circle = new Konva.value.Circle({
    radius: 16, fill: color.value, stroke: '#ffffff', strokeWidth: 2,
  })
  const text = new Konva.value.Text({
    text: String(pinCounter.value++),
    fontSize: 18, fontStyle: 'bold', fill: '#ffffff',
    align: 'center', verticalAlign: 'middle',
    width: 32, height: 32, offsetX: 16, offsetY: 16,
  })
  group.add(circle, text)
  return group
}
function makeText(x, y) {
  return new Konva.value.Text({
    x, y,
    text: 'Texte',
    fontSize: 22, fontStyle: 'bold', fill: color.value,
    draggable: true,
  })
}
function makeBlurRect(x, y, w, h) {
  // Pour le flou : on duplique l'image source restreinte à cette zone
  // et on applique Konva.Filters.Blur dessus.
  const sx = x, sy = y, sw = Math.max(1, w), sh = Math.max(1, h)
  const node = new Konva.value.Image({
    image: imageNode.value.image(),
    x: sx, y: sy, width: sw, height: sh,
    crop: {
      x: sx * (imageNode.value.image().naturalWidth / dims.value.w),
      y: sy * (imageNode.value.image().naturalHeight / dims.value.h),
      width: sw * (imageNode.value.image().naturalWidth / dims.value.w),
      height: sh * (imageNode.value.image().naturalHeight / dims.value.h),
    },
    draggable: true,
    filters: [Konva.value.Filters.Blur],
    blurRadius: 14,
  })
  // Le filtre a besoin d'être caché en bitmap
  node.cache()
  return node
}
function makeSpotlight(x, y, w, h) {
  // Un Group : 1 rect plein opaque (sombre) + 1 rect "trou" (composite destination-out)
  const g = new Konva.value.Group({ draggable: true })
  const overlay = new Konva.value.Rect({
    x: 0, y: 0, width: dims.value.w, height: dims.value.h,
    fill: 'rgba(0, 0, 0, 0.55)', listening: false,
  })
  const hole = new Konva.value.Rect({
    x, y, width: Math.max(1, w), height: Math.max(1, h),
    fill: 'white',
    globalCompositeOperation: 'destination-out',
    cornerRadius: 6,
  })
  g.add(overlay, hole)
  return g
}

// ── Pointer handlers ────────────────────────────────────────────────
function onStagePointerDown(e) {
  if (tool.value === 'select') return
  // Ne pas démarrer si on clique sur un transformer ou une shape existante
  if (e.target !== stage.value && e.target !== imageNode.value) return
  const { x, y } = cursorXY()
  drawStart.value = { x, y }
  isDrawing.value = true
  let node
  if (tool.value === 'arrow') node = makeArrow(x, y)
  else if (tool.value === 'rect') node = makeRect(x, y)
  else if (tool.value === 'ellipse') node = makeEllipse(x, y)
  else if (tool.value === 'blur') node = makeBlurRect(x, y, 0, 0)
  else if (tool.value === 'spotlight') node = makeSpotlight(x, y, 0, 0)
  if (!node) return
  if (tool.value === 'blur') blurLayer.value.add(node)
  else annoLayer.value.add(node)
  currentNode.value = node
}
function onStagePointerMove() {
  if (!isDrawing.value || !currentNode.value) return
  const { x, y } = cursorXY()
  const start = drawStart.value
  const node = currentNode.value
  if (tool.value === 'arrow') {
    node.points([start.x, start.y, x, y])
  } else if (tool.value === 'rect') {
    node.width(x - start.x)
    node.height(y - start.y)
  } else if (tool.value === 'ellipse') {
    node.radiusX(Math.abs(x - start.x))
    node.radiusY(Math.abs(y - start.y))
  } else if (tool.value === 'blur') {
    node.width(Math.max(1, x - start.x))
    node.height(Math.max(1, y - start.y))
    // Re-cache car la zone change
    node.cache()
  } else if (tool.value === 'spotlight') {
    const hole = node.children[1]
    hole.width(Math.max(1, x - start.x))
    hole.height(Math.max(1, y - start.y))
  }
  node.getLayer().batchDraw()
}
function onStagePointerUp() {
  if (!isDrawing.value) return
  isDrawing.value = false
  const node = currentNode.value
  if (node) {
    // Si la shape est trop petite, on l'annule (clic raté)
    const tooSmall = (() => {
      if (node.className === 'Arrow') {
        const [x1, y1, x2, y2] = node.points()
        return Math.hypot(x2 - x1, y2 - y1) < 6
      }
      if (node.width && node.width()) return Math.abs(node.width() * (node.height ? node.height() : 1)) < 36
      if (node.radiusX) return node.radiusX() < 4 || node.radiusY() < 4
      return false
    })()
    if (tooSmall) {
      node.destroy()
      currentNode.value = null
      drawStart.value = null
      return
    }
  }
  currentNode.value = null
  drawStart.value = null
  pushHistory()
}
function onStageClick(e) {
  if (tool.value === 'pin') {
    if (e.target !== stage.value && e.target !== imageNode.value) return
    const { x, y } = cursorXY()
    annoLayer.value.add(makePin(x, y))
    annoLayer.value.batchDraw()
    pushHistory()
    return
  }
  if (tool.value === 'text') {
    if (e.target !== stage.value && e.target !== imageNode.value) return
    const { x, y } = cursorXY()
    const txt = window.prompt('Texte à insérer :', 'Texte')
    if (!txt) return
    const node = makeText(x, y)
    node.text(txt)
    annoLayer.value.add(node)
    annoLayer.value.batchDraw()
    pushHistory()
    return
  }
  // Mode select : sélectionner la shape cliquée
  if (tool.value === 'select') {
    if (e.target === stage.value || e.target === imageNode.value) {
      transformer.value.nodes([])
      annoLayer.value.batchDraw()
      return
    }
    transformer.value.nodes([e.target])
    annoLayer.value.batchDraw()
  }
}

// ── Historique (undo / redo) ────────────────────────────────────────
function snapshot() {
  return {
    anno: annoLayer.value.toJSON(),
    blur: blurLayer.value.toJSON(),
  }
}
function pushHistory() {
  // Tronque la branche redo en cours
  history.value = history.value.slice(0, historyIdx.value + 1)
  history.value.push(snapshot())
  if (history.value.length > 30) history.value.shift()
  historyIdx.value = history.value.length - 1
}
function restoreSnapshot(s) {
  annoLayer.value.destroyChildren()
  blurLayer.value.destroyChildren()
  if (s) {
    const annoNew = Konva.value.Node.create(s.anno)
    annoLayer.value.add(...annoNew.children)
    const blurNew = Konva.value.Node.create(s.blur)
    blurLayer.value.add(...blurNew.children)
    blurLayer.value.children.forEach((n) => n.cache && n.cache())
  }
  // Réattache le transformer
  if (transformer.value) annoLayer.value.add(transformer.value)
  annoLayer.value.batchDraw()
  blurLayer.value.batchDraw()
}
function undo() {
  if (historyIdx.value <= 0) return
  historyIdx.value -= 1
  restoreSnapshot(history.value[historyIdx.value])
}
function redo() {
  if (historyIdx.value >= history.value.length - 1) return
  historyIdx.value += 1
  restoreSnapshot(history.value[historyIdx.value])
}
const canUndo = computed(() => historyIdx.value > 0)
const canRedo = computed(() => historyIdx.value < history.value.length - 1)

// ── Détection PII automatique ────────────────────────────────────────
async function detectPiiAuto() {
  if (piiRunning.value) return
  piiRunning.value = true
  try {
    const bboxes = await detectPii(props.imageBlob)
    if (!bboxes.length) {
      success('Aucune zone PII détectée')
      return
    }
    // Les bboxes sont en coords source ; on les convertit en coords stage
    const sx = dims.value.w / imageNode.value.image().naturalWidth
    const sy = dims.value.h / imageNode.value.image().naturalHeight
    for (const b of bboxes) {
      const x = b.x0 * sx
      const y = b.y0 * sy
      const w = (b.x1 - b.x0) * sx
      const h = (b.y1 - b.y0) * sy
      const blurNode = makeBlurRect(x, y, w, h)
      blurLayer.value.add(blurNode)
    }
    blurLayer.value.batchDraw()
    pushHistory()
    success(`${bboxes.length} zone(s) PII floutée(s) automatiquement`)
  } catch (e) {
    notifyError('Échec détection PII : ' + e.message)
  } finally {
    piiRunning.value = false
  }
}

// ── Validation : flatten en PNG ─────────────────────────────────────
async function validate() {
  // Désélectionner pour ne pas inclure le transformer
  transformer.value.nodes([])
  annoLayer.value.batchDraw()
  await nextTick()
  const dataUrl = stage.value.toDataURL({ pixelRatio: 1, mimeType: 'image/png' })
  const blob = await (await fetch(dataUrl)).blob()
  emit('save', blob)
}

const TOOLS = [
  { key: 'select', icon: CursorArrowRaysIcon, label: 'Sélection' },
  { key: 'arrow', icon: ArrowRightIcon, label: 'Flèche' },
  { key: 'rect', icon: Square2StackIcon, label: 'Rectangle' },
  { key: 'ellipse', icon: EllipsisHorizontalCircleIcon, label: 'Ellipse' },
  { key: 'pin', icon: NumberedListIcon, label: 'Pastille numérotée' },
  { key: 'spotlight', icon: SunIcon, label: 'Spotlight' },
  { key: 'blur', icon: EyeSlashIcon, label: 'Flou manuel' },
  { key: 'text', icon: TextIcon, label: 'Texte' },
]
</script>

<template>
  <BaseModal size="xl" :dismiss-on-backdrop="false" :title="'Annoter la capture'" @close="emit('close')">
    <div class="flex gap-4" style="min-height: 500px;">
      <!-- Toolbar gauche -->
      <div class="flex flex-col gap-1 border-r border-gray-100 pr-3">
        <button v-for="t in TOOLS" :key="t.key" type="button" @click="tool = t.key"
                :class="['p-2 rounded-lg transition flex items-center justify-center w-10 h-10',
                         tool === t.key ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-100']"
                v-tooltip="t.label">
          <component :is="t.icon" class="w-5 h-5" />
        </button>
        <div class="my-1 h-px bg-gray-200" />
        <!-- Couleurs -->
        <div class="grid grid-cols-2 gap-1">
          <button v-for="c in COLORS" :key="c" type="button" @click="color = c"
                  :style="{ backgroundColor: c }"
                  :class="['w-4 h-4 rounded-full border-2 transition',
                           color === c ? 'border-indigo-600 scale-110' : 'border-gray-300']" />
        </div>
        <div class="my-1 h-px bg-gray-200" />
        <button type="button" @click="undo" :disabled="!canUndo"
                class="p-2 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-40 w-10 h-10 flex items-center justify-center"
                v-tooltip="'Annuler'">
          <ArrowUturnLeftIcon class="w-5 h-5" />
        </button>
        <button type="button" @click="redo" :disabled="!canRedo"
                class="p-2 rounded-lg text-gray-600 hover:bg-gray-100 disabled:opacity-40 w-10 h-10 flex items-center justify-center"
                v-tooltip="'Rétablir'">
          <ArrowUturnRightIcon class="w-5 h-5" />
        </button>
        <div class="my-1 h-px bg-gray-200" />
        <button type="button" @click="detectPiiAuto" :disabled="piiRunning"
                class="p-2 rounded-lg text-violet-600 hover:bg-violet-50 disabled:opacity-50 w-10 h-10 flex items-center justify-center"
                v-tooltip="'Détection PII auto (OCR + flou)'">
          <ArrowPathIcon v-if="piiRunning" class="w-5 h-5 animate-spin" />
          <ShieldCheckIcon v-else class="w-5 h-5" />
        </button>
      </div>

      <!-- Canvas -->
      <div ref="containerRef" class="flex-1 flex items-start justify-center bg-gray-100 rounded-lg overflow-auto p-4">
        <div ref="stageRef" />
      </div>
    </div>

    <div class="flex items-center justify-end gap-2 pt-3 mt-3 border-t border-gray-100">
      <button type="button" @click="emit('close')"
              class="px-4 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 transition whitespace-nowrap inline-flex items-center gap-1.5">
        <XMarkIcon class="w-4 h-4 shrink-0" /> Annuler
      </button>
      <button type="button" @click="validate"
              class="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition whitespace-nowrap inline-flex items-center gap-1.5 shadow-sm">
        <CheckIcon class="w-4 h-4 shrink-0" /> Valider l'annotation
      </button>
    </div>
  </BaseModal>
</template>
