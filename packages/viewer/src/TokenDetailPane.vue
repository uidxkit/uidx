<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Dependent } from '@uidx/schema'
import type { TokenRow } from './tokens-view-model'
import TokenSpecimen from './TokenSpecimen.vue'
import { TOKEN_TYPES, tierLabel, visualRole } from './token-presentation'

/**
 * One token, opened as a record (spec §9, and the design studies'
 * token-detail sheet): the definition, the dependents as rows you can jump
 * to, and the destructive actions carrying their blast radius in their own
 * labels — impact-before-edit, enforced by layout.
 *
 * The pane states intent; the shell owns the engine. Rename and delete emit
 * only after a confirm that has already shown every dependent, and delete
 * warns per dependent whose one slot would flatten a moded token.
 */
const props = defineProps<{
  row: TokenRow
  rootFontSize?: number
  dependents: readonly Dependent[]
  /** Dependents whose mode variance delete would flatten (spec §11). */
  deleteWarnings: readonly Dependent[]
  /** Why delete is unavailable (a broken chain), or null when it may run. */
  deleteBlocked: string | null
}>()

const emit = defineEmits<{
  close: []
  jump: [dependent: Dependent]
  rename: [newName: string]
  delete: []
  deprecate: [value: boolean]
}>()

const confirming = ref<'rename' | 'delete' | null>(null)
const newName = ref('')

const files = computed(() => new Set(props.dependents.map((d) => d.file)).size)

const renameLabel = computed(
  () =>
    `Rename (updates ${props.dependents.length} reference${plural(props.dependents.length)} in ${files.value} file${plural(files.value)})`,
)
const deleteLabel = computed(
  () =>
    `Delete (inlines value into ${props.dependents.length} dependent${plural(props.dependents.length)})`,
)

function plural(n: number): string {
  return n === 1 ? '' : 's'
}

function startRename(): void {
  newName.value = props.row.name
  confirming.value = 'rename'
}

function go(): void {
  const what = confirming.value
  confirming.value = null
  if (what === 'rename') {
    const name = newName.value.trim()
    if (name && name !== props.row.name) emit('rename', name)
  }
  if (what === 'delete') emit('delete')
}

function warned(dependent: Dependent): boolean {
  return props.deleteWarnings.includes(dependent)
}

function describe(dependent: Dependent): string {
  const where =
    dependent.kind === 'mode' ? `${dependent.address} · ${dependent.mode}` : dependent.address
  return `${where} — ${dependent.file}`
}
</script>

<template>
  <aside class="token-detail">
    <header>
      <h2>{{ row.name }}</h2>
      <span class="type">{{ TOKEN_TYPES[row.category].label }}</span>
      <span v-if="row.deprecated" class="badge">deprecated</span>
      <button
        type="button"
        class="close-detail"
        aria-label="Close token details"
        @click="emit('close')"
      >
        ×
      </button>
    </header>

    <section class="visual-definition" aria-label="Visual meaning">
      <div v-for="cell in row.cells" :key="cell.mode" class="mode-specimen">
        <TokenSpecimen :row="row" :cell="cell" :root-font-size="rootFontSize" />
        <span>{{ cell.mode }}</span>
      </div>
      <strong>{{ visualRole(row) }}</strong>
      <p v-if="row.description">{{ row.description }}</p>
      <p v-if="row.inferredScopes" class="inferred-note">
        Visual type inferred from the collection or its aliases. No scope is declared.
      </p>
    </section>

    <dl class="record">
      <dt>Tier</dt>
      <dd>{{ tierLabel(row.tier) }}</dd>
      <dt>Collection</dt>
      <dd>{{ row.address.slice(0, row.address.indexOf('#')) }}</dd>
      <dt>Declared in</dt>
      <dd>{{ row.file }}</dd>
    </dl>

    <section class="dependents">
      <h3>
        Dependents <span class="count">{{ dependents.length }}</span>
      </h3>
      <p v-if="dependents.length === 0" class="none">Nothing binds this token.</p>
      <ul>
        <li
          v-for="dependent in dependents"
          :key="`${dependent.file}:${dependent.address}:${dependent.prop}:${dependent.mode ?? ''}`"
          class="dependent"
          @click="emit('jump', dependent)"
        >
          {{ describe(dependent) }}
        </li>
      </ul>
    </section>

    <section class="actions">
      <button type="button" class="deprecate" @click="emit('deprecate', !row.deprecated)">
        {{ row.deprecated ? 'Restore (offer it again)' : 'Deprecate (stop offering it)' }}
      </button>
      <button type="button" class="rename" @click="startRename">{{ renameLabel }}</button>
      <button
        type="button"
        class="delete"
        :disabled="deleteBlocked !== null"
        @click="confirming = 'delete'"
      >
        {{ deleteLabel }}
      </button>
      <p v-if="deleteBlocked" class="blocked">{{ deleteBlocked }}</p>
    </section>

    <div v-if="confirming" class="confirm">
      <template v-if="confirming === 'rename'">
        <p>Every reference below is rewritten to the new name:</p>
        <input v-model="newName" @keydown.enter="go" />
      </template>
      <template v-else>
        <p>Each dependent below keeps the value it currently shows, then the token goes:</p>
      </template>
      <ul>
        <li
          v-for="dependent in dependents"
          :key="`${dependent.file}:${dependent.address}:${dependent.prop}:${dependent.mode ?? ''}`"
        >
          <span class="dependent-name">{{ describe(dependent) }}</span>
          <span v-if="confirming === 'delete' && warned(dependent)" class="flatten-warning">
            mode variance will be lost here
          </span>
        </li>
      </ul>
      <div class="confirm-actions">
        <button type="button" class="go" @click="go">
          {{ confirming === 'rename' ? 'Rename' : 'Delete' }}
        </button>
        <button type="button" @click="confirming = null">Cancel</button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.token-detail {
  min-height: 0;
  background: var(--panel);
  border-left: 1px solid var(--line);
  font-size: 12px;
  overflow: auto;
  overscroll-behavior-y: contain;
  padding: 20px 16px;
  width: 100%;
  flex: none;
}
.close-detail {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--text-faint);
  padding: 2px 5px;
  font-size: 19px;
  cursor: pointer;
}
.close-detail:hover {
  color: var(--text);
}

.visual-definition {
  margin: 20px 0;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--bg);
}
.mode-specimen {
  display: inline-flex;
  flex-direction: column;
  gap: 5px;
  margin: 0 12px 14px 0;
  color: var(--text-faint);
  font-size: 10px;
}
.visual-definition strong {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-dim);
}
.visual-definition p {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-faint);
}

header {
  align-items: baseline;
  display: flex;
  gap: var(--gap-sm);
  margin-bottom: var(--gap);
}

h2 {
  font-size: 13px;
  margin: 0;
}

.type {
  color: var(--text-faint);
}

.badge {
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--text-faint);
  font-size: 10px;
  padding: 0 4px;
}

.record {
  display: grid;
  gap: 2px var(--gap);
  grid-template-columns: auto 1fr;
  margin: 0 0 var(--pad);
}

dt {
  color: var(--text-faint);
}

dd {
  margin: 0;
  overflow-wrap: anywhere;
}

h3 {
  color: var(--text-faint);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.08em;
  margin: 0 0 var(--gap-sm);
  text-transform: uppercase;
}

.dependents ul,
.confirm ul {
  list-style: none;
  margin: 0 0 var(--pad);
  padding: 0;
}

.dependent {
  border-bottom: 1px solid var(--line);
  cursor: pointer;
  overflow-wrap: anywhere;
  padding: 3px 0;
}

.dependent:hover {
  color: var(--accent, #4c6cff);
}

.none {
  color: var(--text-faint);
}

.actions {
  display: flex;
  flex-direction: column;
  gap: var(--gap-sm);
}

.actions button {
  background: none;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  padding: 4px 8px;
  text-align: left;
}

.actions button:disabled {
  cursor: default;
  opacity: 0.5;
}

.actions .delete:not(:disabled):hover {
  border-color: var(--danger, #c0392b);
  color: var(--danger, #c0392b);
}

.blocked {
  color: var(--text-faint);
  margin: 0;
}

.confirm {
  background: var(--raised, rgba(128, 128, 128, 0.08));
  border: 1px solid var(--line);
  border-radius: 6px;
  margin-top: var(--pad);
  padding: var(--gap);
}

.confirm input {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 4px;
  color: inherit;
  font: inherit;
  margin-bottom: var(--gap-sm);
  padding: 3px 6px;
  width: 100%;
}

.flatten-warning {
  color: var(--warn, #b5651d);
  display: block;
}

.confirm-actions {
  display: flex;
  gap: var(--gap-sm);
}

.confirm-actions button {
  background: none;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: inherit;
  cursor: pointer;
  padding: 3px 10px;
}

.confirm-actions .go {
  border-color: var(--accent, #4c6cff);
}
</style>
