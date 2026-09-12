<script setup lang="ts">
import { CREATABLE_ELEMENTS, type CreatableElement } from '@uidx/schema'
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { GRAPHICS_TOOLS, type DrawingTool } from './graphics-tools'

import { LAYER_ICONS, STROKE_ICONS } from './layer-icons'

/**
 * The creation tools and delete (stories D1 and D2).
 *
 * Basic creation tools and a graphics palette. Drawing tools are distinct
 * from file elements: Pencil and shape presets all author Vector layers.
 * Graphics use a split button: the icon activates the last chosen tool and
 * the adjacent arrow opens the palette. Pen is the initial choice.
 *
 * Which tool is armed lives in the shell. The toolbar remembers the last
 * graphics choice even after drawing finishes or another tool is activated.
 */
const props = defineProps<{
  tool: DrawingTool | null
  /**
   * Whether the selection can actually be deleted. False disables the button
   * rather than letting the press throw — D2's own wording, and the reason
   * `canRemove` exists as a predicate instead of only a patcher guard.
   */
  canDelete: boolean
  /**
   * Whether the selection could become a `<Component>` (story F10). False for
   * the page, for a component's sole child, and for a component itself — the
   * same shape of predicate `canDelete` is, and for the same reason.
   */
  canMakeComponent: boolean
  /**
   * The component an instance would be placed from, or null (story F11). Armed
   * like a tool because it uses the same gesture, but held apart because it is
   * a name rather than one of the five elements a person draws.
   */
  placing: string | null
  /** Whether the document declares anything to place. */
  canPlaceInstance: boolean
  /**
   * Whether the selection has somewhere a `<Slot>` could go (story F5).
   *
   * A hole is legal in a frame, a variant and another slot's default content,
   * and nowhere else (ADR 0007 §1) — so unlike the five drawing tools this one
   * is often unavailable, and says so rather than failing on press.
   */
  canAddSlot: boolean
  /** False while the socket is down: nothing here can reach the file. */
  writable: boolean
}>()

const emit = defineEmits<{
  tool: [tool: DrawingTool | null]
  remove: []
  makeComponent: []
  placeInstance: []
  addSlot: []
}>()

/** Figma's letters, echoed in the tooltip so the shortcut is discoverable. */
const SHORTCUT: Record<CreatableElement, string> = {
  Frame: 'F',
  Text: 'T',
  Rectangle: 'R',
  Ellipse: 'O',
  Vector: 'P',
}
const BASIC_TOOLS = CREATABLE_ELEMENTS.filter((element) => element !== 'Vector')
type GraphicsTool = (typeof GRAPHICS_TOOLS)[number]
const lastGraphicsTool = ref<GraphicsTool>(GRAPHICS_TOOLS[0])
watch(
  () => props.tool,
  (tool) => {
    const graphic = GRAPHICS_TOOLS.find((item) => item.tool === tool)
    if (graphic) lastGraphicsTool.value = graphic
  },
  { immediate: true },
)

function pickGraphic(item: GraphicsTool): void {
  lastGraphicsTool.value = item
  graphicsOpen.value = false
  emit('tool', item.tool)
  graphicsMenu.value?.querySelector<HTMLButtonElement>('.graphics-tool')?.focus()
}

/** Pressing the armed tool again puts it away, the way a toggle should. */
function pick(element: DrawingTool): void {
  graphicsOpen.value = false
  emit('tool', props.tool === element ? null : element)
}
const graphicsOpen = ref(false)
const graphicsMenu = ref<HTMLElement | null>(null)
function closeOutside(event: PointerEvent): void {
  if (!graphicsMenu.value?.contains(event.target as Node)) graphicsOpen.value = false
}
async function openGraphics(last = false): Promise<void> {
  graphicsOpen.value = true
  await nextTick()
  const items = graphicsMenu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
  items?.[last ? items.length - 1 : 0]?.focus()
}
function toggleGraphics(): void {
  if (graphicsOpen.value) graphicsOpen.value = false
  else void openGraphics()
}
function toolbarKeys(event: KeyboardEvent): void {
  if ((event.target as HTMLElement).closest('[role="menu"]')) return
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const buttons = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(
      'button:not(:disabled):not([role="menuitem"])',
    ),
  ]
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (index < 0 || !buttons.length) return
  event.preventDefault()
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length
  buttons[next]?.focus()
}
function menuKeys(event: KeyboardEvent): void {
  if (event.code === 'Escape') {
    event.stopPropagation()
    graphicsOpen.value = false
    graphicsMenu.value?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus()
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.code)) return
  event.preventDefault()
  const items = [
    ...(graphicsMenu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []),
  ]
  const i = items.indexOf(document.activeElement as HTMLButtonElement)
  const next =
    event.code === 'Home'
      ? 0
      : event.code === 'End'
        ? items.length - 1
        : (i + (event.code === 'ArrowUp' ? -1 : 1) + items.length) % items.length
  items[next]?.focus()
}
onMounted(() => document.addEventListener('pointerdown', closeOutside))
onUnmounted(() => document.removeEventListener('pointerdown', closeOutside))
</script>

<template>
  <div class="tools" role="toolbar" aria-label="Create" @keydown="toolbarKeys">
    <button
      type="button"
      class="tool"
      :data-armed="tool === null && placing === null ? 'true' : 'false'"
      :aria-pressed="tool === null && placing === null"
      :disabled="!writable"
      title="Select — V"
      aria-label="Select"
      @click="emit('tool', null)"
    >
      <!-- Figma's arrow, so the default state has a face of its own. -->
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2 1l7 5-3 .6L4.6 10z" fill="currentColor" />
      </svg>
    </button>

    <span class="divider" />

    <button
      v-for="element in BASIC_TOOLS"
      :key="element"
      type="button"
      class="tool"
      :data-armed="tool === element ? 'true' : 'false'"
      :disabled="!writable"
      :title="`${element} — ${SHORTCUT[element]}`"
      :aria-label="element"
      :aria-pressed="tool === element"
      @click="pick(element)"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path
          :d="LAYER_ICONS[element]"
          :fill="STROKE_ICONS.has(element) ? 'none' : 'currentColor'"
          :stroke="STROKE_ICONS.has(element) ? 'currentColor' : 'none'"
        />
      </svg>
    </button>

    <div ref="graphicsMenu" class="graphics-menu" @keydown="menuKeys">
      <button
        type="button"
        class="tool graphics-tool"
        :data-armed="tool === lastGraphicsTool.tool ? 'true' : 'false'"
        :disabled="!writable"
        :title="lastGraphicsTool.label + (lastGraphicsTool.key ? ` — ${lastGraphicsTool.key}` : '')"
        :aria-label="lastGraphicsTool.label"
        :aria-pressed="tool === lastGraphicsTool.tool"
        @click="pickGraphic(lastGraphicsTool)"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path :d="lastGraphicsTool.icon" fill="none" stroke="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        class="graphics-trigger"
        aria-label="Graphics tools"
        aria-haspopup="menu"
        :aria-expanded="graphicsOpen"
        :disabled="!writable"
        :data-armed="tool === lastGraphicsTool.tool ? 'true' : 'false'"
        title="Choose a graphics tool"
        @click="toggleGraphics"
        @keydown.down.prevent.stop="openGraphics()"
        @keydown.up.prevent.stop="openGraphics(true)"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" />
        </svg>
      </button>
      <div v-if="graphicsOpen" class="graphics-popover" role="menu" aria-label="Graphics tools">
        <p class="menu-heading">Draw graphics</p>
        <button
          v-for="item in GRAPHICS_TOOLS"
          :key="item.tool"
          type="button"
          role="menuitem"
          :disabled="!writable"
          :aria-label="`${item.label} tool`"
          :data-active="lastGraphicsTool.tool === item.tool"
          @click="pickGraphic(item)"
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path :d="item.icon" fill="none" stroke="currentColor" />
          </svg>
          <span>{{ item.label }}</span
          ><kbd>{{ item.key }}</kbd>
        </button>
        <p class="menu-hint">
          Draw a graphic, then make it a component to reuse it as an icon or symbol.
        </p>
      </div>
    </div>

    <span class="divider" />

    <!--
      Each button wears the icon of the thing it makes, which is the rule the
      five drawing tools already follow: the rail's `Component` for the one that
      makes a definition, the rail's `Instance` for the one that places a use.
      Figma draws the same distinction the same way round.
    -->
    <button
      type="button"
      class="tool"
      :disabled="!writable || !canMakeComponent"
      title="Make component — ⌘/ctrl+alt+K"
      aria-label="Make component"
      @click="emit('makeComponent')"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path :d="LAYER_ICONS.Component" fill="currentColor" />
      </svg>
    </button>

    <!--
      A slot is inserted, never swept: ADR 0007 rejected a canvas indicator for
      an empty one, so there is nothing to drag out and this places it beside
      the selection instead. That is why it sits with the two gestures rather
      than with the five drawing tools.
    -->
    <button
      type="button"
      class="tool"
      :disabled="!writable || !canAddSlot"
      title="New slot"
      aria-label="New slot"
      @click="emit('addSlot')"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path :d="LAYER_ICONS.Slot" fill="none" stroke="currentColor" />
      </svg>
    </button>

    <button
      type="button"
      class="tool"
      :data-armed="placing !== null ? 'true' : 'false'"
      :disabled="!writable || !canPlaceInstance"
      :title="placing === null ? 'Place instance' : `Place ${placing} — click the canvas`"
      aria-label="Place instance"
      :aria-pressed="placing !== null"
      @click="emit('placeInstance')"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path :d="LAYER_ICONS.Instance" fill="none" stroke="currentColor" />
      </svg>
    </button>

    <span class="divider" />

    <button
      type="button"
      class="tool danger"
      :disabled="!writable || !canDelete"
      title="Delete — ⌫"
      aria-label="Delete"
      @click="emit('remove')"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path
          d="M2.5 3.5h7M4.5 3.5V2h3v1.5M3.5 3.5l.5 7h4l.5-7"
          fill="none"
          stroke="currentColor"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.tools {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: center;
  flex-wrap: wrap;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
  box-shadow: var(--shadow-float);
  --tool-size: 36px;
}
.tool {
  display: grid;
  place-items: center;
  width: var(--tool-size);
  height: var(--tool-size);
  padding: 0;
  background: none;
  border: none;
  border-radius: 8px;
  color: var(--text-dim);
  cursor: pointer;
  flex: none;
}
.tool:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.tool[data-armed='true'],
.tool[data-armed='true']:hover:not(:disabled) {
  background: var(--accent);
  color: var(--text);
}
.tool:disabled {
  color: var(--text-faint);
  opacity: 0.4;
  cursor: default;
}
.tool.danger:hover:not(:disabled) {
  color: var(--danger);
}
.tool svg {
  width: 18px;
  height: 18px;
  stroke-width: 1;
}
.divider {
  width: 1px;
  height: 20px;
  flex: none;
  margin: 0 2px;
  background: var(--line);
}
</style>

<style scoped>
.graphics-menu {
  position: relative;
  display: flex;
  align-items: center;
}
.graphics-tool {
  border-radius: 8px 0 0 8px;
}
.graphics-trigger {
  display: grid;
  place-items: center;
  width: 20px;
  height: var(--tool-size);
  border: 0;
  border-radius: 0 8px 8px 0;
  padding: 0;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  flex: none;
  font: inherit;
}
.graphics-trigger:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.graphics-trigger[data-armed='true'],
.graphics-tool[data-armed='true']:hover {
  background: var(--accent);
  color: var(--text);
}
.graphics-trigger svg {
  width: 12px;
  height: 12px;
}
.graphics-trigger:disabled {
  opacity: 0.4;
  cursor: default;
}
.graphics-popover {
  position: absolute;
  bottom: calc(100% + 16px);
  right: 0;
  width: 224px;
  max-width: calc(100cqw - 32px);
  max-height: calc(100dvh - 132px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: var(--shadow-float);
  z-index: 40;
}
.menu-heading {
  color: var(--text-dim);
  font-size: 11px;
  padding: 6px 8px;
  margin: 0;
}
.graphics-popover button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px;
  border: 0;
  border-radius: 4px;
  color: inherit;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.graphics-popover button:hover,
.graphics-popover button:focus-visible,
.graphics-popover button[data-active='true'] {
  background: var(--raised);
}
.graphics-popover svg {
  width: 16px;
  height: 16px;
  stroke-width: 1;
}
.graphics-popover kbd {
  margin-left: auto;
  font: inherit;
  font-size: 11px;
  color: var(--text-dim);
}
.menu-hint {
  padding: 8px;
  margin: 4px 0 0;
  border-top: 1px solid var(--line);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-dim);
}
</style>

<style scoped>
.tools button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
@container (max-width: 560px) {
  .tools {
    --tool-size: 30px;
    gap: 2px;
    padding: 6px;
    border-radius: 12px;
  }
  .tool svg {
    width: 16px;
    height: 16px;
  }
  .divider {
    margin: 0 1px;
  }
  .graphics-trigger {
    width: 16px;
  }
}
@container (max-width: 400px) {
  .tools {
    --tool-size: 26px;
    gap: 1px;
  }
  .tool svg {
    width: 14px;
    height: 14px;
  }
  .graphics-trigger {
    width: 14px;
  }
}
</style>
