<script setup lang="ts">
defineProps<{
  title: string
  page?: string | null
  view: 'home' | 'page' | 'tokens' | 'fonts'
  canGoHome: boolean
  renderable: boolean
}>()

const emit = defineEmits<{ home: []; face: [view: 'page' | 'tokens' | 'fonts'] }>()
</script>

<template>
  <header class="workspace-nav" :class="{ overview: view === 'home' }">
    <div class="identity">
      <component
        :is="canGoHome && view !== 'home' ? 'button' : 'span'"
        class="brand"
        :type="canGoHome && view !== 'home' ? 'button' : undefined"
        :aria-label="canGoHome && view !== 'home' ? 'Document overview' : 'uidx'"
        :title="canGoHome && view !== 'home' ? 'Back to document overview' : 'uidx'"
        @click="canGoHome && view !== 'home' && emit('home')"
      >
        <svg viewBox="0 0 48 24" width="48" height="24" aria-hidden="true">
          <g
            fill="none"
            stroke="currentColor"
            stroke-width="2.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M3 8v7a3.5 3.5 0 0 0 7 0V8M16 8v10M28 3v15h-3.5a5 5 0 0 1 0-10H28M35 8l9 10M44 8l-9 10"
            />
          </g>
          <circle cx="16" cy="3.5" r="1.3" fill="currentColor" />
        </svg>
      </component>
      <div class="document">
        <span class="document-title" :title="title">{{ title }}</span>
        <span v-if="page && view !== 'home'" class="page-title" :title="page">{{ page }}</span>
        <span v-else class="page-title">Design workspace</span>
      </div>
    </div>
    <nav v-if="view !== 'home'" class="face-toggle" aria-label="Page view">
      <button
        type="button"
        :aria-pressed="view === 'page'"
        :disabled="!renderable"
        @click="emit('face', 'page')"
      >
        Elements
      </button>
      <button type="button" :aria-pressed="view === 'tokens'" @click="emit('face', 'tokens')">
        Tokens
      </button>
      <button type="button" :aria-pressed="view === 'fonts'" @click="emit('face', 'fonts')">
        Fonts
      </button>
    </nav>
  </header>
</template>

<style scoped>
.workspace-nav {
  flex: none;
  padding: 16px 12px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}
.identity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.brand {
  display: grid;
  place-items: center;
  flex: none;
  padding: 2px;
  border: 0;
  border-radius: 6px;
  color: var(--text);
  background: none;
}
button.brand {
  cursor: pointer;
}
button.brand:hover {
  background: var(--raised);
}
.document {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.document-title,
.page-title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.document-title {
  font-size: 11px;
  font-weight: 600;
}
.page-title {
  color: var(--text-dim);
  font-size: 10px;
}
.face-toggle {
  display: flex;
  gap: 2px;
  margin-top: 16px;
  padding: 3px;
  background: var(--bg);
  border-radius: 8px;
}
.face-toggle button {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 3px;
  border: 0;
  border-radius: 5px;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}
.face-toggle button[aria-pressed='true'] {
  background: var(--raised);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}
.face-toggle button:hover:not(:disabled) {
  color: var(--text);
}
.face-toggle button:disabled {
  opacity: 0.4;
  cursor: default;
}
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.overview {
  border: 0;
  padding: 12px 20px;
}
</style>
