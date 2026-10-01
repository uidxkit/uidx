<script setup lang="ts">
import TutorialList from './TutorialList.vue'
import { dismissWelcome, welcomed } from './tour'
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

const emit = defineEmits<{
  open: [file: string]
  tokens: [collection: string]
  /** Start a tutorial. */
  tutorial: [id: string]
}>()
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
    { label: 'Pages', value: stats.pages, note: `${stats.scenes} with content` },
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
      label: 'Problems',
      value: stats.brokenPages,
      note:
        stats.brokenPages === 0
          ? 'every page opens'
          : `${stats.brokenPages === 1 ? 'a page' : 'pages'} cannot be drawn`,
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

    <!--
      Learning by doing: each tutorial points at the real controls and moves
      on as the designer does the step. Said as a welcome on a first visit,
      kept as a quiet list after.
    -->
    <section
      class="block learn"
      :data-welcome="!welcomed || undefined"
      aria-labelledby="learn-title"
      data-tour="tutorials"
    >
      <div class="learn-head">
        <h2 id="learn-title" class="block-title">
          {{ welcomed ? 'Tutorials' : 'New to uidx? Learn by building' }}
        </h2>
        <button v-if="!welcomed" type="button" class="not-now" @click="dismissWelcome">
          Not now
        </button>
      </div>
      <p v-if="!welcomed" class="empty">
        Pick one. The editor points at where to click and moves on as you go — about four minutes
        each.
      </p>
      <TutorialList @start="emit('tutorial', $event)" />
    </section>

    <section
      v-if="connected && model.stats.components === 0"
      class="block start"
      aria-labelledby="start-title"
    >
      <h2 id="start-title" class="block-title">Start a design system</h2>
      <p class="empty">
        Nothing here declares a component yet. Start from one of these, in a terminal at your
        project, or ask your coding agent to — it has the uidx skills and MCP tools.
      </p>
      <ul class="starts">
        <li>
          <code>npx uidx init --design-system</code>
          <span>tiered tokens with light and dark modes, and a Button to copy from</span>
        </li>
        <li>
          <code>npx uidx tokens import tokens.json</code>
          <span>tokens exported from Figma, Tokens Studio or Style Dictionary (DTCG)</span>
        </li>
        <li>
          <code>npx uidx adopt node_modules/…/custom-elements.json</code>
          <span>a draft component for every element your headless library ships</span>
        </li>
      </ul>
    </section>

    <section class="block">
      <div class="pages-heading">
        <h2 class="block-title">
          Pages <span class="count">{{ model.cards.length }}</span>
        </h2>
        <button
          class="new-page"
          type="button"
          data-tour="new-page"
          :disabled="!connected"
          @click="creating = true"
        >
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
  padding: 36px max(24px, calc((100% - 1200px) / 2)) 64px;
  background: var(--bg);
}
.masthead {
  margin-bottom: 28px;
}
.doc {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 32px;
}
.sub {
  margin: 6px 0 0;
  color: var(--text-dim);
  font-size: 13px;
}
.kpis {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin: 0 0 36px;
  padding: 0;
  list-style: none;
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  box-shadow: var(--shadow-sm);
}
.kpi-label {
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 500;
}
.kpi-value {
  font-size: 28px;
  font-weight: 600;
  line-height: 34px;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}
.kpi[data-alarm='true'] .kpi-value {
  color: var(--danger);
}
.kpi-note {
  color: var(--text-faint);
  font-size: 11px;
}
.block {
  margin-bottom: 36px;
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  border: 0;
  border-radius: 7px;
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 0 14px;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
}
.new-page:hover:not(:disabled) {
  filter: brightness(1.08);
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
  gap: 8px;
  margin: 0 0 12px;
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
}
.block-title .count {
  padding: 0 7px;
  border-radius: 10px;
  background: var(--raised);
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
}
.count {
  font-variant-numeric: tabular-nums;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.collections {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}
.collection {
  display: flex;
  align-items: center;
  gap: var(--gap);
  height: 40px;
  padding: 0 16px;
  font-size: 12px;
  background: var(--panel);
  border: none;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
  width: 100%;
}
.collection:hover {
  background: var(--raised);
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
.starts {
  display: grid;
  gap: 8px;
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
}
.starts li {
  display: grid;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.starts code {
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 12px;
  color: var(--text);
}
.starts span {
  font-size: 12px;
  color: var(--text-dim);
}
.learn[data-welcome] {
  padding: 18px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line));
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}
.learn-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.not-now {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-faint);
  font: inherit;
  cursor: pointer;
}
.not-now:hover {
  color: var(--text);
}
</style>
