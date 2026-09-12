import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { AGENT_DIR, resolveInside } from '../edit/jail.js'
import { isValidTaskId } from './store.js'

/** A component the page will define or reuse, declared before any canvas work. */
export interface PlannedComponent {
  name: string
  /** Configurable props, e.g. label: TEXT. */
  props: { name: string; type: string }[]
  /** Variant axes and every value each takes. */
  axes: { name: string; values: string[] }[]
}

/** One token scale the page commits to binding, and at which tier. */
export interface PlannedBinding {
  collection: string
  /** The tier this scale plays — primitive, semantic, component — as the author names it. */
  tier?: string
  /** What on the page binds to it, in one line. */
  usedFor: string
  /** `exists` in the token docs already, or `declare` — this task will add it. */
  status: 'exists' | 'declare'
}

/** One canvas section, in build order. */
export interface PlannedSection {
  name: string
  /** What the section holds, in one line — the brief its build step starts from. */
  holds: string
}

/**
 * The architecture a task commits to before building: which components with
 * which axes, which token scales at which tier, which sections in which order.
 *
 * This exists because its absence was measured. Every model run invented its
 * component API, token usage and section order *while* building: one run bound
 * twenty tokens and never touched the declared `space` scale, another's
 * component grew axes mid-page, and sections disagreed with each other about
 * the instance coordinates they used. The decisions that must stay consistent
 * across every step were being re-guessed at every step.
 *
 * It is the structured-note pattern the plan store already uses — durable,
 * outside the window, re-injected each turn — holding the *decisions* where
 * the plan holds the *progress*.
 */
export interface Architecture {
  taskId: string
  /** One line: what is being built and why this shape. */
  summary: string
  components: PlannedComponent[]
  tokens: PlannedBinding[]
  sections: PlannedSection[]
  /**
   * Geometry and behaviour rules the *research* states, extracted by the
   * model rather than authored here — "the thumb must be at least as tall as
   * the track", "the thumb overlaps the track's edge". They ride into every
   * build brief and into review's standard, because the failure they close
   * was measured: a model wrote the correct anatomy in its own annotation and
   * then drew the thumb dead centre. What the research constrains, the
   * building must obey — and first it has to be written down.
   */
  constraints: string[]
  /**
   * How the thing *looks*, distilled from reference images into the model's
   * own words — parts, layering (what draws on top of what), resting
   * positions per state, proportions as ratios. Vision translated into
   * language, because language survives: pictures get evicted and cost
   * tokens every step, while a written spec rides in every brief for free.
   * Measured without it: a model studied three real switches and still drew
   * from prose, because by drawing time the pictures were gone from view and
   * nothing durable had been kept of what they showed.
   */
  appearance: string[]
}

/** An architecture file exists but its content isn't one — same contract as `PlanCorruptError`. */
export class ArchitectureCorruptError extends Error {}

export interface ArchitectureStore {
  read(taskId: string): Promise<Architecture | null>
  write(architecture: Architecture): Promise<void>
  /** The compact markdown form a model sees — never the raw JSON. */
  render(architecture: Architecture): string
}

/** Caps on the rendered form, for the same reason `renderPlan` has them: every field is model-authored and rides in every later turn's instructions. */
const MAX_LINE_CHARS = 160
const MAX_RENDER_CHARS = 2_400

const clip = (text: string, max = MAX_LINE_CHARS): string =>
  text.length > max ? `${text.slice(0, max)}…` : text

function renderArchitecture(architecture: Architecture): string {
  const lines = [`Architecture: ${clip(architecture.summary)}`]
  if (architecture.components.length > 0) {
    lines.push('Components:')
    for (const component of architecture.components) {
      const axes = component.axes
        .map((axis) => `${axis.name}: ${axis.values.join(' | ')}`)
        .join('; ')
      const props = component.props.map((prop) => `${prop.name} (${prop.type})`).join(', ')
      lines.push(clip(`- ${component.name} — axes ${axes}${props ? ` — props ${props}` : ''}`))
    }
  }
  if (architecture.tokens.length > 0) {
    lines.push('Token plan:')
    for (const binding of architecture.tokens) {
      const tier = binding.tier ? ` (${binding.tier})` : ''
      const status = binding.status === 'declare' ? ' [to declare]' : ''
      lines.push(clip(`- ${binding.collection}${tier}${status} — ${binding.usedFor}`))
    }
  }
  if (architecture.appearance.length > 0) {
    lines.push('Appearance, learned from the reference images — draw what these words say:')
    for (const line of architecture.appearance) lines.push(clip(`- ${line}`))
  }
  if (architecture.constraints.length > 0) {
    lines.push('Constraints, from the research — the building must obey them:')
    for (const constraint of architecture.constraints) lines.push(clip(`- ${constraint}`))
  }
  if (architecture.sections.length > 0) {
    lines.push('Sections, in order:')
    for (const [i, section] of architecture.sections.entries()) {
      lines.push(clip(`${i + 1}. ${section.name} — ${section.holds}`))
    }
  }
  let used = 0
  const kept: string[] = []
  for (const line of lines) {
    if (used + line.length + 1 > MAX_RENDER_CHARS) {
      kept.push('(architecture too long to render in full)')
      break
    }
    kept.push(line)
    used += line.length + 1
  }
  return kept.join('\n')
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNamed = (value: unknown, keys: string[]): boolean =>
  isRecord(value) && keys.every((key) => typeof value[key] === 'string')

/** Just enough shape-checking to catch a hand-edited or half-written file — the same bar `isPlan` sets. */
function isArchitecture(value: unknown): value is Architecture {
  if (!isRecord(value)) return false
  if (typeof value.taskId !== 'string' || typeof value.summary !== 'string') return false
  const { components, tokens, sections, constraints, appearance } = value
  return (
    Array.isArray(constraints) &&
    constraints.every((c) => typeof c === 'string') &&
    Array.isArray(appearance) &&
    appearance.every((a) => typeof a === 'string') &&
    Array.isArray(components) &&
    components.every(
      (c) =>
        isNamed(c, ['name']) &&
        Array.isArray((c as Record<string, unknown>).props) &&
        Array.isArray((c as Record<string, unknown>).axes),
    ) &&
    Array.isArray(tokens) &&
    tokens.every((t) => isNamed(t, ['collection', 'usedFor', 'status'])) &&
    Array.isArray(sections) &&
    sections.every((s) => isNamed(s, ['name', 'holds']))
  )
}

async function writeAtomically(path: string, contents: string): Promise<void> {
  const temp = `${path}.agent-tmp`
  await writeFile(temp, contents, 'utf8')
  await rename(temp, path)
}

export function createArchitectureStore(root: string): ArchitectureStore {
  const pathFor = (taskId: string): string => {
    if (!isValidTaskId(taskId)) throw new Error(`no architecture for task ${taskId}: not a task id`)
    return resolveInside(root, `${AGENT_DIR}/architecture/${taskId}.json`)
  }

  return {
    async read(taskId) {
      let raw: string
      try {
        raw = await readFile(pathFor(taskId), 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
      let value: unknown
      try {
        value = JSON.parse(raw)
      } catch {
        throw new ArchitectureCorruptError(`the architecture for task ${taskId} is not valid JSON`)
      }
      if (!isArchitecture(value)) {
        throw new ArchitectureCorruptError(
          `the architecture for task ${taskId} does not have the shape of one`,
        )
      }
      return value
    },
    async write(architecture) {
      const path = pathFor(architecture.taskId)
      await mkdir(dirname(path), { recursive: true })
      await writeAtomically(path, JSON.stringify(architecture, null, 2))
    },
    render: renderArchitecture,
  }
}
