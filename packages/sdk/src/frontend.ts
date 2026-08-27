import type { FrontendAnswer } from "@missingstudio/eva-core"
import type { Effect } from "effect"

export type FrontendRequest =
  | { readonly kind: "permission"; readonly id: string; readonly question: string }
  | { readonly kind: "question"; readonly id: string; readonly question: string }

/**
 * What a Surface implements and Eva calls. The opposite direction to
 * SessionAPI.
 *
 * What a surface can do is not here. A surface declares that on its
 * `SurfaceInfo` row, which is what `pickSurface` reads and what decides
 * whether Eva may ask this surface anything at all. The same three booleans
 * were spelled a second time on the Frontend, by hand, beside the first —
 * nothing held the two to each other, and only the row was ever read.
 */
export interface Frontend {
  readonly id: string
  /**
   * The one path Eva uses when it needs a person. A surface whose row says
   * `interactive: false` is never asked.
   *
   * An ask ends one of two ways, and both are the surface's to handle. It
   * resolves with the person's answer — or it is interrupted, because the
   * other door answered the same request first. An interrupted ask retires
   * whatever it showed: the question is over, and a surface that kept asking
   * would be waiting on an answer nobody can use. A surface with nobody
   * behind it answers `cancelled` rather than waiting forever.
   */
  readonly ask: (request: FrontendRequest) => Effect.Effect<FrontendAnswer>
  // Completes when the surface has stopped. The process waits on this.
  readonly done: Effect.Effect<void>
}
