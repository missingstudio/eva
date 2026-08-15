/** @jsxImportSource @opentui/react */
import { createCliRenderer, decodePasteBytes, type PasteEvent } from "@opentui/core"
import { createRoot, useKeyboard, usePaste } from "@opentui/react"
import { EMPTY, type Frame, type KeyPress, type Renderer } from "@missingstudio/eva-tui-core"
import { useSyncExternalStore } from "react"
import { App } from "./app.js"
import { toKeyPress, type RawKey } from "./keys.js"
import { DEFAULT_PALETTE, type Palette } from "./palette.js"

// The frame lives outside React so `draw` is a plain call the surface makes.
// React subscribes; it never owns the state.
export const makeStore = () => {
  const listeners = new Set<() => void>()
  let current: Frame = EMPTY

  return {
    get: () => current,
    set: (frame: Frame) => {
      current = frame
      for (const listener of listeners) listener()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

type Store = ReturnType<typeof makeStore>

/**
 * The tree this renderer mounts. It is named here so the render check can
 * mount it too: `makeOpenTuiRenderer` builds its own screen, and a check
 * has none to give it.
 */
export const Root = ({
  store,
  palette,
  onKey,
  onPaste,
}: {
  store: Store
  palette: Palette
  onKey: (key: KeyPress) => void
  onPaste: (text: string) => void
}) => {
  const frame = useSyncExternalStore(store.subscribe, store.get)
  useKeyboard((key: RawKey) => onKey(toKeyPress(key)))
  // A paste is its own event here. OpenTUI reports a pasted block as one
  // sequence with no key name, which is nothing the keymap or the line
  // editor can read — it used to fall through both and vanish.
  usePaste((event: PasteEvent) => onPaste(decodePasteBytes(event.bytes)))
  return <App frame={frame} palette={palette} />
}

/**
 * The OpenTUI renderer. It needs Bun's FFI, so nothing imports this module
 * until a surface actually starts — the composition root reaches it through
 * a dynamic import and falls back to the stream renderer elsewhere.
 *
 * It is built with no colors of its own: the Frame carries the theme, and
 * the palette below is only what a Frame that names none is drawn in.
 */
export const makeOpenTuiRenderer = async (): Promise<Renderer> => {
  const store = makeStore()
  const handlers = new Set<(key: KeyPress) => void>()
  const pastes = new Set<(text: string) => void>()
  const cli = await createCliRenderer()
  const root = createRoot(cli)

  root.render(
    <Root
      store={store}
      palette={DEFAULT_PALETTE}
      onKey={(key) => {
        for (const handler of handlers) handler(key)
      }}
      onPaste={(text) => {
        for (const handler of pastes) handler(text)
      }}
    />,
  )

  let stopped = false
  return {
    // A frame drawn after stop is nobody's: the screen has been handed back.
    draw: (frame) => {
      if (stopped) return
      store.set(frame)
    },
    // It owns a screen, so it draws everything the Frame can carry.
    draws: { panels: true, colors: true },
    onKey: (handler) => {
      handlers.add(handler)
      return () => void handlers.delete(handler)
    },
    onPaste: (handler) => {
      pastes.add(handler)
      return () => void pastes.delete(handler)
    },
    // A screen's input does not end: OpenTUI owns a TTY, where ctrl+d is a
    // key press like any other. The registration is honoured; nothing fires.
    onEnd: () => () => {},
    stop: () => {
      if (stopped) return

      stopped = true
      handlers.clear()
      pastes.clear()
      root.unmount()
      cli.destroy()
    },
  }
}
