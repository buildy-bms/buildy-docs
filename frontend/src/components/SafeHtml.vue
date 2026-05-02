<script setup>
import { computed } from 'vue'
import DOMPurify from 'dompurify'

// Wrapper a utiliser a la place de v-html pour tout contenu non statique
// (notes, contenu Claude, transcripts, articles BACS edites...). Il
// supprime <script>, on*= handlers, et javascript: hrefs.
//
// Pour les balises stricte UI (rich text Tiptap : tables, liens, listes),
// on autorise un set conservateur. Si tu as besoin de plus, ajoute ici.
const props = defineProps({
  html: { type: String, default: '' },
  tag: { type: String, default: 'div' },
})

const ALLOWED_TAGS = [
  'a','b','blockquote','br','code','div','em','figure','figcaption','h1','h2','h3','h4','h5','h6',
  'hr','i','img','li','ol','p','pre','small','span','strong','sub','sup',
  'table','tbody','td','tfoot','th','thead','tr','u','ul',
]
const ALLOWED_ATTR = ['href','title','alt','src','colspan','rowspan','class','target','rel']

const sanitized = computed(() =>
  DOMPurify.sanitize(props.html || '', {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['script','style','iframe','object','embed','form'],
    FORBID_ATTR: ['style','onerror','onload','onclick','onfocus','onmouseover'],
  })
)
</script>

<template>
  <component :is="tag" v-html="sanitized" />
</template>
