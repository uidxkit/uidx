import { ref, shallowRef } from 'vue'
import { snapshot, TUTORIALS, type TourMemory, type TourState, type Tutorial } from './tutorials'

/**
 * Where a tutorial run is: which tutorial, which step, and what existed when
 * it began. Module state, like the theme: one run at a time for the whole
 * editor, and remembered across a reload so a refresh mid-tour picks up
 * where it was.
 */
export interface TourRun {
  tutorial: Tutorial
  index: number
  memory: TourMemory
}

const RUN_KEY = 'uidx.tour.run'
const DONE_KEY = 'uidx.tour.completed'
const WELCOME_KEY = 'uidx.tour.welcomed'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Private windows and blocked storage: the tour still runs, it just forgets.
  }
}

function restore(): TourRun | null {
  const raw = read(RUN_KEY)
  if (!raw) return null
  try {
    const saved = JSON.parse(raw) as {
      id: string
      index: number
      memory: { components: string[]; models: string[]; pages: string[] }
    }
    const tutorial = TUTORIALS.find((candidate) => candidate.id === saved.id)
    if (!tutorial) return null
    return {
      tutorial,
      index: Math.min(saved.index, tutorial.steps.length - 1),
      memory: {
        components: new Set(saved.memory.components),
        models: new Set(saved.memory.models),
        pages: new Set(saved.memory.pages),
      },
    }
  } catch {
    return null
  }
}

function persist(next: TourRun | null): void {
  write(
    RUN_KEY,
    next
      ? JSON.stringify({
          id: next.tutorial.id,
          index: next.index,
          memory: {
            components: [...next.memory.components],
            models: [...next.memory.models],
            pages: [...next.memory.pages],
          },
        })
      : null,
  )
}

export const tourRun = shallowRef<TourRun | null>(restore())

/** Tutorials finished at least once, for the ticks in the list. */
export const completedTutorials = ref<string[]>(
  (() => {
    try {
      return JSON.parse(read(DONE_KEY) ?? '[]') as string[]
    } catch {
      return []
    }
  })(),
)

/** Whether the first-visit welcome has been answered — started a tutorial, or "Not now". */
export const welcomed = ref(read(WELCOME_KEY) === '1' || tourRun.value !== null)

export function dismissWelcome(): void {
  welcomed.value = true
  write(WELCOME_KEY, '1')
}

function set(next: TourRun | null): void {
  tourRun.value = next
  persist(next)
}

export function startTutorial(id: string, state: TourState): void {
  const tutorial = TUTORIALS.find((candidate) => candidate.id === id)
  if (!tutorial) return
  dismissWelcome()
  set({ tutorial, index: 0, memory: snapshot(state) })
}

export function goToStep(index: number): void {
  const run = tourRun.value
  if (!run) return
  if (index >= run.tutorial.steps.length) {
    finishTutorial()
    return
  }
  set({ ...run, index: Math.max(0, index) })
}

export function finishTutorial(): void {
  const run = tourRun.value
  if (run && !completedTutorials.value.includes(run.tutorial.id)) {
    completedTutorials.value = [...completedTutorials.value, run.tutorial.id]
    write(DONE_KEY, JSON.stringify(completedTutorials.value))
  }
  set(null)
}

export function stopTutorial(): void {
  set(null)
}
