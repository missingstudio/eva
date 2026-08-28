import type { Client } from "@missingstudio/eva-client-runtime"
import {
  modelRef,
  type Domain,
  type Harness,
  type HarnessHost,
  type ModelRef,
  type Row,
  type SessionAPI,
  type ToolInfo,
} from "@missingstudio/eva-core"
import { toUsd, type ModelPrice, type PriceLookup, type SessionID } from "@missingstudio/eva-schema"
import type { Effect, Scope } from "effect"
import type { Frontend } from "./frontend.js"

export interface ProviderInfo {
  id: string
  name: string
  api?: string
}

export interface ModelInfo {
  id: string
  name: string
  contextWindow?: number
  reasoning?: boolean
  // The vendor's published rate. A Domain is rebuilt and not recorded, so a
  // price here reaches an estimate and never a `costTicks`.
  price?: ModelPrice
}

export interface CatalogState {
  readonly providers: Map<string, ProviderInfo>
  readonly models: Map<string, Map<string, ModelInfo>>
  default?: ModelRef
}

export interface CatalogDraft {
  readonly provider: {
    list(): readonly ProviderInfo[]
    get(providerID: string): ProviderInfo | undefined
    update(providerID: string, update: (provider: ProviderInfo) => void): void
    remove(providerID: string): void
  }
  readonly model: {
    get(providerID: string, modelID: string): ModelInfo | undefined
    update(providerID: string, modelID: string, update: (model: ModelInfo) => void): void
    remove(providerID: string, modelID: string): void
    readonly default: {
      get(): ModelRef | undefined
      set(model: ModelRef): void
    }
  }
}

/**
 * One row of a choice, as the command that offers it writes one. It is the
 * command's vocabulary and not a panel's: a surface that draws panels shows
 * these as rows, and one that cannot writes them as lines.
 */
export interface PickRow {
  readonly id: string
  readonly label: string
  readonly detail?: string
  /**
   * The colors this row would paint, when the row names a theme. A surface
   * that paints shows them while the row is under the selection — a theme is
   * looked at before it is chosen — and taking the row is still what applies
   * them, through `paint`.
   */
  readonly colors?: Record<string, string>
}

/**
 * What a command is given when it runs. The surface supplies it, so the same
 * command works from the terminal and from any other surface.
 *
 * The last two are capabilities rather than obligations: a surface supplies
 * what it can do, and a command that finds one absent says its answer in
 * words instead. That is what keeps one command correct on a screen and on
 * a pipe without either knowing about the other.
 */
export interface CommandContext {
  readonly api: SessionAPI
  readonly session: SessionID
  readonly argument?: string
  readonly write: (text: string) => void
  // A command that opens a different Session says so, and the surface follows.
  readonly select: (session: SessionID) => void
  /**
   * Ask the person to choose one row. Nothing is what they kept what they
   * had — a choice a person did not make is never a choice made for them.
   */
  readonly pick?: (title: string, rows: readonly PickRow[]) => Effect.Effect<PickRow | undefined>
  /**
   * Paint the screen in these colors. A row that is not a theme — one that
   * misses a color the renderer contract names — paints nothing, so the
   * command that offers colors is the one that has to say why.
   */
  readonly paint?: (colors: Record<string, string>) => void
}

// A row without `run` names a command the build knows of but cannot execute.
export interface CommandInfo {
  id: string
  description: string
  aliases?: readonly string[]
  argumentHint?: string
  run?: (ctx: CommandContext) => Effect.Effect<void>
}

/**
 * The row editor lives in core, beside the other extension-point shapes, so
 * the kernel can build one and the SDK can name it without either importing
 * the other. A plugin still reaches it from here.
 */
export type { Row } from "@missingstudio/eva-core"

/**
 * The tool row lives in core for the same reason, and one more: the execution
 * that executes a tool is core's, and core may not import the SDK. A plugin
 * still reaches the row from here.
 */
export type { ToolInfo } from "@missingstudio/eva-core"

export interface ThemeInfo {
  id: string
  name: string
  colors: Record<string, string>
}

export interface KeymapInfo {
  id: string
  binding: string
  command: string
  surface?: string
}

export interface AgentInfo {
  id: string
  model?: ModelRef
  prompt?: string
  tools?: readonly string[]
}

export interface PromptInfo {
  id: string
  /**
   * The Template text. A row with no text is not a Template, so this is
   * required, and the projection drops an empty one rather than registering a
   * row that fills to nothing and then fails at the wire.
   */
  text: string
}

/**
 * A harness row is a factory, not an instance: five Claude Code sessions in
 * five worktrees are five instances of one harness kind. A row without `open`
 * describes a harness the build knows of but cannot run — the same rule
 * `SurfaceInfo.start` states.
 */
export interface HarnessInfo {
  id: string
  name: string
  open?: (host: HarnessHost) => Effect.Effect<Harness, never, Scope.Scope>
}

/**
 * A surface row is a factory, not an instance: it is started, stopped, and
 * started again. A row without `start` describes a surface the build knows
 * of but cannot run.
 */
export interface SurfaceInfo {
  id: string
  interactive: boolean
  streaming: boolean
  images: boolean
  start?: (client: Client) => Effect.Effect<Frontend, never, Scope.Scope>
}

export interface IntegrationInfo {
  id: string
  provider: string
  mode: "api_key" | "oauth"
  connected: boolean
}

// A release date on a model id. A response names the model it really ran,
// which carries one where the Catalog's id does not. Two spellings, because
// two vendors write it two ways: `claude-opus-5-20260101` and
// `gpt-4o-mini-2024-07-18`.
const RELEASED = /-(\d{8}|\d{4}-\d{2}-\d{2})$/

/**
 * The Catalog's prices, as the fold reads them. A usage record names its
 * model the way a reference is written, so this parses one and answers what
 * the Catalog holds — or nothing, which nulls the estimate rather than
 * pricing part of a session.
 *
 * `claude-opus-5-20260101` is the same model as `claude-opus-5` and costs the
 * same, so a dated id falls back to the undated one. Without that, every
 * estimate is null in a real Run and only in a real Run, because a response
 * names a date and a request does not.
 */
export const priceLookup =
  (state: CatalogState): PriceLookup =>
  (model: string) => {
    const reference = modelRef(model)
    if (reference === undefined) return undefined

    const offered = state.models.get(reference.provider)
    if (offered === undefined) return undefined

    return (
      offered.get(reference.model)?.price ??
      offered.get(reference.model.replace(RELEASED, ""))?.price
    )
  }

// What the Catalog knows about a model that helps somebody choose one. A
// fact the Catalog does not hold is left unsaid rather than guessed at.
const modelDetail = (model: ModelInfo): string =>
  [
    model.contextWindow === undefined ? "" : `${Math.round(model.contextWindow / 1000)}k context`,
    model.price === undefined ? "" : `$${toUsd(model.price.inputTicks).toFixed(2)}/Mtok in`,
  ]
    .filter((part) => part !== "")
    .join(" · ")

/**
 * Every model this build can reach, named the way a person types one — so
 * the row a panel takes is the argument the line would have carried.
 *
 * It lives here, beside the Catalog it reads, and not beside the command that
 * first drew it: a wire answers these rows to a surface that holds no
 * Catalog, and a picker on a page and a panel in a terminal reading two
 * spellings would disagree the first week a Provider ships a model.
 */
export const modelRows = (catalog: CatalogState): readonly PickRow[] =>
  [...catalog.models].flatMap(([provider, models]) =>
    [...models.values()].map((model) => ({
      id: `${provider}/${model.id}`,
      label: `${provider}/${model.id}`,
      detail: modelDetail(model),
    })),
  )

/**
 * The domain table: every domain of plain rows, against the Info it holds.
 * This is the one declaration. The domain type, the `<name>.updated` topic,
 * the field on a plugin's context, and what the kernel assembles are all
 * derived from it, so adding a domain is this line and the row it builds —
 * not five edits across three files that must agree.
 *
 * The catalog is not here because it is the one domain that is not rows.
 */
export interface RowInfos {
  readonly command: CommandInfo
  readonly theme: ThemeInfo
  readonly keymap: KeymapInfo
  readonly agent: AgentInfo
  readonly prompt: PromptInfo
  readonly harness: HarnessInfo
  readonly surface: SurfaceInfo
  readonly integration: IntegrationInfo
  readonly tool: ToolInfo
}

export type RowDomainName = keyof RowInfos

export type RowDomains = {
  readonly [Name in RowDomainName]: Domain<readonly RowInfos[Name][], Row<RowInfos[Name]>>
}

// Every domain the kernel holds. A plugin's context carries exactly these.
// A domain is reached as a field of the context, so it needs no alias of its
// own: `RowInfos` names the Info, and the domain type derives from it.
export type Domains = RowDomains & { readonly catalog: Domain<CatalogState, CatalogDraft> }
