<script setup lang="ts">
import { computed, ref } from 'vue'
import NewPageDialog from './NewPageDialog.vue'

import PageThumb from './PageThumb.vue'
import type { HomeModel, PageCard } from './home-model'

/**
 * The document, on one screen.
 *
 * Everything here is derived from state the shell already holds: the server
 * sends every page on connect (ADR 0004 §1), so the dashboard needs no protocol
 * message of its own and no round trip. It is a *view* of the same documents the
 * canvas draws from, which is what makes it impossible for the two to disagree.
 *
 * The pane owns no thumbnail machinery. It is handed a `render` function and
 * passes it down, so mounting the grid in a test costs nothing and the pane
 * stays a layout.
 */
const props = defineProps<{
  model: HomeModel
  /** Renders one page. See `PageThumb`, which decides when to call it. */
  render: (card: PageCard) => Promise<string | null>
  /**
   * Page id -> a stamp for what that page's picture depends on outside itself.
   *
   * Assembled by the shell, which is the only thing that sees the whole
   * document. Passed straight through: the grid has no opinion about it, but a
   * tile cannot redraw for a component or an image it draws through without it.
   */
  stamps: ReadonlyMap<string, string>
  /** The page the canvas has open behind the dashboard, if any. */
  current: string | null
  /** The document's id, from the manifest. */
  title: string | null
  connected?: boolean
}>()

const emit = defineEmits<{ open: [file: string]; tokens: [collection: string] }>()
const creating = ref(false)

function created(file: string): void {
  creating.value = false
  emit('open', file)
}

/**
 * The four numbers across the top.
 *
 * Assembled as data rather than written out as four blocks of markup so that
 * the rule holds visibly: a tile is a label and a count, and a count comes from
 * `homeModel`. There is nowhere here to put a number that is not derived.
 */
const kpis = computed(() => {
  const { stats } = props.model
  return [
    { label: 'Pages', value: stats.pages, note: `${stats.scenes} drawable` },
    {
      label: 'Components',
      value: stats.components,
      note: stats.variants > 0 ? `${stats.variants} variants` : `${stats.instances} instances`,
    },
    {
      label: 'Tokens',
      value: stats.tokens,
      note: `${stats.collections.length} collections`,
    },
    {
      label: 'Errors',
      value: stats.brokenPages,
      note: stats.brokenPages === 0 ? 'all pages parse' : 'pages will not parse',
      alarm: stats.brokenPages > 0,
    },
  ]
})
</script>

<template>
  <div class="home">
    <header class="masthead">
      <h1 class="doc">{{ title ?? 'Document' }}</h1>
      <p class="sub">Every page of the document. Open one to edit it.</p>
    </header>

    <ul class="kpis">
      <li
        v-for="kpi in kpis"
        :key="kpi.label"
        class="kpi"
        :data-alarm="kpi.alarm ? 'true' : 'false'"
      >
        <span class="kpi-label">{{ kpi.label }}</span>
        <span class="kpi-value">{{ kpi.value }}</span>
        <span class="kpi-note">{{ kpi.note }}</span>
      </li>
    </ul>

    <section class="block">
      <div class="pages-heading">
        <h2 class="block-title">
          Pages <span class="count">{{ model.cards.length }}</span>
        </h2>
        <button class="new-page" type="button" :disabled="!connected" @click="creating = true">
          New page
        </button>
      </div>
      <p v-if="!connected" class="empty" role="status">
        Waiting for the server to load your pages…
      </p>
      <p v-else-if="!model.cards.length" class="empty">
        No pages yet. Create a page to start designing.
      </p>
      <ul class="grid" role="listbox" aria-label="Pages">
        <PageThumb
          v-for="card in model.cards"
          :key="card.file"
          :card="card"
          :render="render"
          :stamp="stamps.get(card.file) ?? ''"
          :current="card.file === current"
          @open="emit('open', $event)"
        />
      </ul>
    </section>
    <NewPageDialog v-if="creating" @created="created" @close="creating = false" />

    <!--
      Collections rather than every variable. The dashboard's job is to say what
      the document *has*; a value belongs to the page that declares it and to
      the inspector that binds to it, both one click away.
    -->
    <section v-if="model.stats.collections.length" class="block">
      <h2 class="block-title">
        Tokens <span class="count">{{ model.stats.tokens }}</span>
      </h2>
      <ul class="collections">
        <!--
          A collection row leads to the tokens view (spec §1) — the card
          finally goes somewhere, the way every page tile always has.
        -->
        <li v-for="collection in model.stats.collections" :key="collection.name">
          <button type="button" class="collection" @click="emit('tokens', collection.name)">
            <span class="collection-name">{{ collection.name }}</span>
            <span class="collection-count">{{ collection.variables }}</span>
            <span class="modes">
              <span v-for="mode in collection.modes" :key="mode" class="mode">{{ mode }}</span>
            </span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.home {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: var(--section-pad);
  background: var(--bg);
}
.masthead {
  margin-bottom: var(--section-pad);
}
.doc {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 24px;
}
.sub {
  margin: 2px 0 0;
  color: var(--text-faint);
}
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--gap);
  margin: 0 0 var(--section-pad);
  padding: 0;
  list-style: none;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--pad) var(--gap);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
}
.kpi-label {
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.kpi-value {
  font-size: 22px;
  line-height: 28px;
  font-variant-numeric: tabular-nums;
}
.kpi[data-alarm='true'] .kpi-value {
  color: var(--danger);
}
.kpi-note {
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.block {
  margin-bottom: var(--section-pad);
}
.pages-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--gap);
}
.pages-heading .block-title {
  margin: 0;
}
.new-page {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--accent);
  color: var(--text);
  font: inherit;
  padding: 6px 12px;
  cursor: pointer;
}
.new-page:disabled {
  opacity: 0.5;
  cursor: default;
}
.empty {
  color: var(--text-faint);
}
.block-title {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  margin: 0 0 var(--gap);
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.count {
  font-variant-numeric: tabular-nums;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--gap);
  margin: 0;
  padding: 0;
  list-style: none;
}
.collections {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  overflow: hidden;
}
.collection {
  display: flex;
  align-items: center;
  gap: var(--gap);
  height: var(--field-h);
  padding: 0 var(--gap);
  background: var(--panel);
  border: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  width: 100%;
}
.collection:hover {
  background: var(--panel-raised, var(--panel));
}
li + li .collection {
  border-top: 1px solid var(--line);
}
.collection-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.collection-count {
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}
.modes {
  display: flex;
  gap: var(--gap-sm);
}
.mode {
  padding: 0 var(--gap-sm);
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
}
</style>
