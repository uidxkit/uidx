<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref } from 'vue'
import {
  fontsInFileKey,
  importGoogleFont,
  projectFonts,
  refreshFontLibrary,
  removeFont,
  uploadFont,
  type ProjectFont,
} from './font-library'

const props = defineProps<{ selected?: string; picking?: boolean }>()
const emit = defineEmits<{ close: []; select: [family: string] }>()
const inFile = inject(
  fontsInFileKey,
  computed(() => [] as string[]),
)
const dialog = ref<HTMLDialogElement | null>(null)
const search = ref('')
const filter = ref('all')
const tab = ref('library')
const familyCount = computed(
  () => new Set(['Inter', ...projectFonts.value.map((font) => font.family)]).size,
)
const family = ref('')
const weight = ref(400)
const italic = ref(false)
const sample = ref('The quick brown fox jumps over the lazy dog.')
const preview = ref(props.selected ?? 'Inter')
const busy = ref(false)
const error = ref('')
const notice = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const returnFocus = document.activeElement as HTMLElement | null
const popular = [
  'Roboto',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Nunito',
  'Raleway',
  'Playfair Display',
  'Merriweather',
  'DM Sans',
  'Space Grotesk',
  'IBM Plex Sans',
  'Source Sans 3',
  'Noto Sans',
  'Noto Sans Hebrew',
  'Noto Sans Arabic',
  'Noto Sans JP',
  'Roboto Mono',
  'Space Mono',
  'Lora',
]
const weights = [
  'Thin',
  'Extra light',
  'Light',
  'Regular',
  'Medium',
  'Semibold',
  'Bold',
  'Extra bold',
  'Black',
]
const families = computed(() => {
  const names = new Set([
    'Inter',
    ...projectFonts.value.map((f) => f.family),
    ...inFile.value,
    ...(props.selected ? [props.selected] : []),
  ])
  return [...names]
    .filter((name) => {
      if (!name.toLowerCase().includes(search.value.toLowerCase())) return false
      if (filter.value === 'file') return inFile.value.includes(name)
      if (filter.value === 'google' || filter.value === 'custom')
        return projectFonts.value.some((f) => f.family === name && f.source === filter.value)
      return true
    })
    .sort((a, b) => a.localeCompare(b))
})
const previewFonts = computed(() => projectFonts.value.filter((f) => f.family === preview.value))
function source(name: string): string {
  if (name === 'Inter') return 'Bundled · 4 styles'
  const faces = projectFonts.value.filter((f) => f.family === name)
  return faces.length
    ? `${faces.some((f) => f.source === 'custom') ? 'Uploaded' : 'Google Fonts'} · ${faces.length} style${faces.length === 1 ? '' : 's'}`
    : 'Missing · import this font'
}
function available(name: string): boolean {
  return name === 'Inter' || projectFonts.value.some((font) => font.family === name)
}
function choose(name: string): void {
  preview.value = name
  if (props.picking && available(name)) {
    emit('select', name)
    emit('close')
  }
}
function findGoogle(): void {
  family.value = preview.value
  tab.value = 'google'
}
async function work(action: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await action()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Unable to import font.'
  } finally {
    busy.value = false
  }
}
function addGoogle(): void {
  void work(async () => {
    const font = await importGoogleFont(family.value.trim(), weight.value, italic.value)
    preview.value = font.family
    tab.value = 'library'
    filter.value = 'all'
    search.value = ''
    notice.value = `${font.family} ${font.style} is ready to use.`
  })
}
function upload(event: Event): void {
  const files = Array.from((event.target as HTMLInputElement).files ?? [])
  if (!files.length) return
  void work(async () => {
    const failures: string[] = []
    let added = 0
    for (const file of files) {
      try {
        const font = await uploadFont(file)
        preview.value = font.family
        added++
      } catch (e) {
        failures.push(`${file.name}: ${e instanceof Error ? e.message : 'Import failed.'}`)
      }
    }
    if (added) {
      tab.value = 'library'
      filter.value = 'all'
      search.value = ''
      notice.value = `${added} font style${added === 1 ? '' : 's'} imported.`
    }
    error.value = failures.join(' ')
    if (fileInput.value) fileInput.value.value = ''
  })
}
function remove(font: ProjectFont): void {
  void work(async () => {
    await removeFont(font.id)
    notice.value = `${font.family} ${font.style} removed from the project. Reload the viewer to update open canvases.`
  })
}
onMounted(() => {
  if (props.picking) dialog.value?.showModal()
  void work(refreshFontLibrary)
  if (props.picking)
    void nextTick(() => dialog.value?.querySelector<HTMLInputElement>('input')?.focus())
})
onUnmounted(() => {
  if (props.picking) returnFocus?.focus()
})
</script>

<template>
  <component
    :is="picking ? 'dialog' : 'main'"
    ref="dialog"
    class="font-dialog"
    :class="{ 'font-page': !picking }"
    aria-labelledby="font-library-title"
    @cancel.prevent="emit('close')"
    @click="$event.target === dialog && emit('close')"
    @keydown.stop
    @pointerdown.stop
  >
    <div class="fonts-content">
      <header class="page-heading">
        <div>
          <div v-if="!picking" class="eyebrow">DESIGN SYSTEM / TYPOGRAPHY</div>
          <h1 id="font-library-title">
            {{ picking ? 'Choose a font' : 'Fonts'
            }}<span v-if="!picking" class="count">{{ familyCount }}</span>
          </h1>
          <p>Add, preview, and manage the fonts available across your project.</p>
        </div>
        <button
          v-if="picking"
          type="button"
          class="close"
          aria-label="Close fonts"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <nav class="font-tabs" aria-label="Font library tabs">
        <button type="button" :aria-pressed="tab === 'library'" @click="tab = 'library'">
          Project fonts
        </button>
        <button type="button" :aria-pressed="tab === 'google'" @click="tab = 'google'">
          Add Google font
        </button>
        <button type="button" :aria-pressed="tab === 'upload'" @click="tab = 'upload'">
          Upload fonts
        </button>
      </nav>
      <div v-if="error" class="message error" role="alert">{{ error }}</div>
      <div v-if="notice" class="message" role="status">{{ notice }}</div>
      <div v-if="busy" class="message" role="status">Loading fonts…</div>

      <section v-if="tab === 'library'" class="library" aria-label="Project font library">
        <div class="library-toolbar">
          <label class="search-field">
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5.5" />
              <path d="m13 13 4 4" />
            </svg>
            <input
              v-model="search"
              type="search"
              aria-label="Search fonts"
              placeholder="Search font families…"
            />
          </label>
          <select v-model="filter" aria-label="Filter fonts">
            <option value="all">All fonts</option>
            <option value="file">In this file</option>
            <option value="google">Google Fonts</option>
            <option value="custom">Uploaded by you</option>
          </select>
        </div>
        <div class="results-line">
          {{ families.length }} {{ families.length === 1 ? 'family' : 'families'
          }}<span>{{
            picking ? 'Select a family to apply it.' : 'Select a family to inspect its styles.'
          }}</span>
        </div>
        <div class="library-panels">
          <div class="browse">
            <div class="panel-heading">Font family</div>
            <div class="font-list" aria-label="Font families">
              <button
                v-for="name in families"
                :key="name"
                type="button"
                class="font-option"
                :aria-pressed="preview === name"
                @focus="preview = name"
                @mouseenter="preview = name"
                @click="choose(name)"
              >
                <span>{{ name }}</span
                ><small>{{ source(name) }}</small>
              </button>
              <p v-if="!families.length" class="empty">
                No matching fonts. Add a Google font or upload your own.
              </p>
            </div>
          </div>
          <div class="specimen">
            <div class="panel-heading">Preview</div>
            <div class="specimen-content">
              <div class="specimen-heading">
                <h2>{{ preview }}</h2>
                <small>{{ source(preview) }}</small>
              </div>
              <div class="preview-box">
                <p class="large-sample" :style="{ fontFamily: JSON.stringify(preview) }">
                  Aa Bb Cc
                </p>
                <textarea
                  v-model="sample"
                  aria-label="Font preview text"
                  aria-describedby="sample-help"
                  :style="{ fontFamily: JSON.stringify(preview) }"
                />
              </div>
              <p id="sample-help" class="field-help">
                Edit the sample above to preview your own text.
              </p>
              <div class="styles">
                <h3>Available styles</h3>
                <div v-for="font in previewFonts" :key="font.id" class="style-row">
                  <span
                    :style="{
                      fontFamily: JSON.stringify(font.family),
                      fontWeight: font.weight,
                      fontStyle: font.italic ? 'italic' : 'normal',
                    }"
                    >{{ font.style }}</span
                  >
                  <button
                    type="button"
                    class="remove"
                    :disabled="busy"
                    :aria-label="`Remove ${font.family} ${font.style}`"
                    @click="remove(font)"
                  >
                    Remove
                  </button>
                </div>
                <div v-if="preview === 'Inter'" class="bundled-styles">
                  <span v-for="style in ['Regular', 'Medium', 'Semibold', 'Bold']" :key="style">{{
                    style
                  }}</span>
                </div>
                <p v-if="!available(preview)" class="field-help">
                  This font is used in your project but has not been imported.
                </p>
              </div>
              <button
                v-if="picking && available(preview)"
                type="button"
                class="primary"
                @click="choose(preview)"
              >
                Use {{ preview }}
              </button>
              <button v-if="!available(preview)" type="button" class="primary" @click="findGoogle">
                Find on Google Fonts
              </button>
            </div>
          </div>
        </div>
      </section>

      <form v-else-if="tab === 'google'" class="import-form" @submit.prevent="addGoogle">
        <div class="form-heading">
          <h2>Add a Google font</h2>
          <p>
            Choose a font family and a style. It will be available on every page in this project.
          </p>
        </div>
        <div class="form-fields">
          <div class="field-block">
            <label for="google-font-family">Font family</label>
            <input
              id="google-font-family"
              v-model="family"
              list="google-families"
              placeholder="e.g. Roboto"
              required
              maxlength="200"
              :disabled="busy"
              aria-describedby="family-help"
            />
            <p id="family-help" class="field-help">
              Enter the family name as it appears on Google Fonts.
            </p>
            <datalist id="google-families">
              <option v-for="name in popular" :key="name" :value="name" />
            </datalist>
            <div class="suggestions">
              <span>Try</span
              ><button
                v-for="name in popular.slice(0, 4)"
                :key="name"
                type="button"
                :disabled="busy"
                @click="family = name"
              >
                {{ name }}
              </button>
            </div>
          </div>
          <div class="style-fields">
            <div class="field-block">
              <label for="google-font-weight">Weight</label
              ><select id="google-font-weight" v-model.number="weight" :disabled="busy">
                <option v-for="(name, i) in weights" :key="name" :value="(i + 1) * 100">
                  {{ name }} · {{ (i + 1) * 100 }}
                </option>
              </select>
            </div>
            <div class="field-block">
              <label for="google-font-style">Style</label
              ><select id="google-font-style" v-model="italic" :disabled="busy">
                <option :value="false">Normal</option>
                <option :value="true">Italic</option>
              </select>
            </div>
          </div>
          <p class="field-help">
            Start with Regular. You can add other weights or italic styles later.
          </p>
        </div>
        <div class="form-actions">
          <span>Saved with your project for offline use.</span
          ><button type="submit" class="primary" :disabled="busy || !family.trim()">
            {{ busy ? 'Importing…' : 'Import style' }}
          </button>
        </div>
        <p class="form-note">
          An internet connection is needed only when importing from Google Fonts.
        </p>
      </form>

      <section v-else class="import-form upload-form" aria-label="Upload font files">
        <div class="form-heading">
          <h2>Upload font files</h2>
          <p>
            Add fonts from your computer. Select several files to import a family’s styles together.
          </p>
        </div>
        <div class="form-fields">
          <div class="upload-area">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" />
            </svg>
            <strong>Add your own fonts</strong
            ><span>Choose static TrueType or OpenType files.</span>
            <button type="button" class="primary" :disabled="busy" @click="fileInput?.click()">
              Choose font files
            </button>
          </div>
          <dl class="upload-details">
            <div>
              <dt>File formats</dt>
              <dd>.ttf and .otf (static fonts)</dd>
            </div>
            <div>
              <dt>File size</dt>
              <dd>Up to 20 MB per file</dd>
            </div>
            <div>
              <dt>Family and style</dt>
              <dd>Detected automatically from each file</dd>
            </div>
          </dl>
        </div>
        <p class="form-note">
          After uploading, find your fonts in Project fonts and apply them from the text inspector.
        </p>
      </section>
      <input
        ref="fileInput"
        type="file"
        accept=".ttf,.otf"
        multiple
        hidden
        aria-label="Upload font files"
        @change="upload"
      />
      <footer v-if="picking">
        Fonts are saved with this project.<button
          type="button"
          class="secondary"
          @click="emit('close')"
        >
          Done
        </button>
      </footer>
    </div>
  </component>
</template>

<style scoped>
.font-dialog {
  width: min(760px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  min-width: 0;
  padding: 0;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
  font: var(--ui-size)/var(--ui-line) var(--ui-font);
  overflow: auto;
  overscroll-behavior: contain;
  container-type: inline-size;
}
.font-dialog::backdrop {
  background: var(--overlay);
}
.font-page {
  width: auto;
  height: 100%;
  max-height: none;
  min-height: 0;
  flex: 1;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.fonts-content {
  max-width: 1600px;
  margin: 0 auto;
  padding: 26px 36px 48px;
}
button,
input,
select,
textarea {
  font: inherit;
  color: inherit;
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.page-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.eyebrow {
  font-size: var(--ui-size-sm);
  font-weight: 500;
  letter-spacing: 0.1em;
  color: var(--text-faint);
}
h1 {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 13px 0 10px;
  font-size: 27px;
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: -0.8px;
}
.count {
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 2px 7px;
  color: var(--text-faint);
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  letter-spacing: 0;
}
.page-heading p {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1.6;
}
.close {
  flex: none;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 5px;
  font-size: 20px;
  color: var(--text-dim);
}
.close:hover {
  color: var(--text);
  background: var(--raised);
}
.font-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 18px;
}
.font-tabs button {
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-dim);
  line-height: 16px;
  transition:
    background 0.12s,
    color 0.12s;
}
.font-tabs button:hover:not(:disabled) {
  color: var(--text);
  background: var(--panel);
}
.font-tabs button[aria-pressed='true'],
.font-tabs button[aria-pressed='true']:hover {
  color: var(--text);
  background: var(--raised);
  border-color: var(--line);
}
.library-toolbar {
  display: flex;
  gap: 8px;
}
.search-field {
  display: flex;
  flex: 1;
  min-width: 120px;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 5px;
}
.search-field svg {
  width: 14px;
  height: 14px;
  flex: none;
  stroke: var(--text-faint);
  stroke-width: 1.4;
}
.search-field input {
  width: 100%;
  min-width: 0;
  height: 34px;
  padding: 0;
  border: 0;
  background: transparent;
}
.search-field:focus-within {
  border-color: var(--accent);
}
.search-field input:focus {
  outline: 0;
}
input::placeholder {
  color: var(--text-faint);
}
select {
  color-scheme: dark;
}
.library-toolbar select {
  min-width: 140px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--panel);
}
.results-line {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.library-panels {
  display: grid;
  grid-template-columns: minmax(220px, 38%) minmax(0, 1fr);
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
  background: var(--panel);
}
.browse {
  min-width: 0;
  border-right: 1px solid var(--line);
}
.panel-heading {
  display: flex;
  align-items: center;
  height: 34px;
  padding: 0 12px;
  border-bottom: 1px solid var(--line);
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  font-weight: 500;
}
.font-list {
  max-height: 520px;
  overflow-y: auto;
  padding: 4px;
}
.font-option {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  min-height: 44px;
  padding: 6px 9px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  text-align: left;
}
.font-option > span {
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
}
.font-option small {
  font-size: var(--ui-size-sm);
  line-height: 14px;
  color: var(--text-faint);
}
.font-option:hover {
  background: var(--raised);
}
.font-option[aria-pressed='true'] {
  background: var(--accent-dim);
  border-color: transparent;
}
.font-option[aria-pressed='true'] small {
  color: var(--text-dim);
}
.empty {
  color: var(--text-dim);
  line-height: 1.6;
  padding: 12px;
  margin: 0;
}
.specimen {
  min-width: 0;
}
.specimen-content {
  padding: 20px;
}
.specimen-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 16px;
}
h2 {
  font-size: 15px;
  line-height: 20px;
  font-weight: 500;
  margin: 0;
}
.specimen-heading small {
  font-size: var(--ui-size-sm);
  color: var(--text-faint);
}
.preview-box {
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--bg);
}
.large-sample {
  font-size: 40px;
  line-height: 1.3;
  margin: 0 0 16px;
  overflow-wrap: anywhere;
}
.preview-box textarea {
  display: block;
  width: 100%;
  min-height: 88px;
  max-height: 250px;
  resize: vertical;
  padding: 0;
  border: 0;
  border-radius: 2px;
  font-size: 18px;
  line-height: 1.6;
  color: var(--text);
  background: transparent;
}
.field-help {
  margin: 7px 0 0;
  font-size: var(--ui-size-sm);
  line-height: 1.6;
  color: var(--text-faint);
}
.styles {
  margin: 20px 0;
}
.styles h3 {
  margin: 0 0 8px;
  font-size: var(--ui-size);
  font-weight: 500;
  color: var(--text-dim);
}
.style-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 32px;
  border-bottom: 1px solid var(--line);
}
.remove {
  padding: 3px 6px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.remove:hover:not(:disabled) {
  background: var(--raised);
  color: var(--danger);
}
.bundled-styles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.bundled-styles span {
  padding: 3px 6px;
  border: 1px solid var(--line);
  border-radius: 3px;
  font-size: var(--ui-size-sm);
  color: var(--text-dim);
}
.primary,
.secondary {
  min-height: 32px;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: 5px;
  font-weight: 500;
  white-space: nowrap;
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text);
}
.primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 86%, var(--text));
  border-color: transparent;
}
.secondary {
  background: var(--panel);
  color: var(--text-dim);
}
.secondary:hover {
  color: var(--text);
  background: var(--raised);
}
.import-form {
  width: 100%;
  max-width: 580px;
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  overflow: hidden;
}
.form-heading {
  padding: 20px 20px 0;
}
.form-heading p {
  max-width: 450px;
  margin: 7px 0 0;
  color: var(--text-dim);
  line-height: 1.6;
}
.form-fields {
  padding: 20px;
}
.field-block {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.field-block label {
  margin-bottom: 7px;
  font-size: var(--ui-size);
  font-weight: 500;
}
.field-block input,
.field-block select {
  width: 100%;
  height: 34px;
  min-width: 0;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--bg);
}
.style-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 22px;
}
.suggestions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 10px;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.suggestions > span {
  margin-right: 3px;
}
.suggestions button {
  padding: 3px 6px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--text-dim);
}
.suggestions button:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-top: 1px solid var(--line);
}
.form-actions > span {
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
}
.form-note {
  margin: 0;
  padding: 12px 20px;
  border-top: 1px solid var(--line);
  font-size: var(--ui-size-sm);
  color: var(--text-faint);
  line-height: 1.6;
}
.upload-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 16px;
  border: 1px dashed var(--line);
  border-radius: 5px;
  background: var(--bg);
  text-align: center;
}
.upload-area svg {
  width: 24px;
  height: 24px;
  margin-bottom: 4px;
  stroke: var(--text-faint);
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.upload-area strong {
  font-size: 12px;
  font-weight: 500;
}
.upload-area > span {
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.upload-area button {
  margin-top: 8px;
}
.upload-details {
  margin: 20px 0 0;
}
.upload-details > div {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 12px;
  margin-top: 8px;
  font-size: var(--ui-size-sm);
  line-height: 1.6;
}
.upload-details dt {
  color: var(--text-faint);
}
.upload-details dd {
  margin: 0;
  color: var(--text-dim);
}
.message {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--panel);
  color: var(--text-dim);
  line-height: 1.6;
}
.error {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 40%, var(--line));
}
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  font-size: var(--ui-size-sm);
  color: var(--text-faint);
}
.font-dialog:not(.font-page) .fonts-content {
  padding: 20px;
}
.font-dialog:not(.font-page) h1 {
  font-size: 18px;
  margin: 0 0 7px;
  letter-spacing: -0.3px;
}
.font-dialog:not(.font-page) .page-heading {
  margin-bottom: 18px;
}
@container (max-width: 900px) {
  .fonts-content {
    padding: 26px 22px 44px;
  }
}
@container (max-width: 640px) {
  .fonts-content {
    padding: 22px 16px 36px;
  }
  h1 {
    font-size: 23px;
  }
  .library-panels {
    grid-template-columns: 1fr;
  }
  .browse {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .font-list {
    max-height: 184px;
  }
  .specimen-content {
    padding: 16px;
  }
  .page-heading p {
    font-size: 11px;
  }
  .form-heading {
    padding: 16px 16px 0;
  }
  .form-fields {
    padding: 16px;
  }
  .form-actions {
    padding: 12px 16px;
  }
  .form-note {
    padding: 12px 16px;
  }
}
@container (max-width: 380px) {
  .library-toolbar {
    flex-wrap: wrap;
  }
  .search-field {
    flex-basis: 100%;
  }
  .library-toolbar select {
    width: 100%;
    height: 34px;
  }
  .font-tabs {
    gap: 2px;
  }
  .font-tabs button {
    padding: 7px 8px;
  }
  .form-actions {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }
  .form-actions .primary {
    align-self: flex-end;
  }
  .upload-details > div {
    grid-template-columns: 90px 1fr;
    gap: 8px;
  }
}
</style>
