import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { assetFor, fromSource, hasPage, mediaType, unbuilt } from "./assets.js"

// A tree in the shape `vp build` leaves: the page, and hashed assets beside it.
const built = (): string => {
  const root = mkdtempSync(join(tmpdir(), "eva-web-assets-"))
  mkdirSync(join(root, "assets"))
  writeFileSync(join(root, "index.html"), "<!doctype html><div id=page></div>")
  writeFileSync(join(root, "assets", "index-abc123.js"), "export const page = 1\n")
  return root
}

describe("what a request is answered with", () => {
  it("answers the root with the page", () => {
    const root = built()
    expect(assetFor(root, "/")).toBe(resolve(root, "index.html"))
  })

  it("answers a built asset with that file", () => {
    const root = built()
    expect(assetFor(root, "/assets/index-abc123.js")).toBe(
      resolve(root, "assets", "index-abc123.js"),
    )
  })

  it("reads the path out of a request that carries a query", () => {
    const root = built()
    expect(assetFor(root, "/assets/index-abc123.js?v=2")).toBe(
      resolve(root, "assets", "index-abc123.js"),
    )
  })

  // A deep link is a path the router owns, so the page is what answers it
  // and the page routes it. Without this, a reload of any route is a 404.
  it("answers a path that names no file with the page", () => {
    const root = built()
    expect(assetFor(root, "/sessions/019a")).toBe(resolve(root, "index.html"))
  })

  // A path that names a file and has none is a miss. A script request
  // answered with HTML reads as a broken bundle, not as a miss.
  it("misses a file that names an extension and is not there", () => {
    expect(assetFor(built(), "/assets/index-gone.js")).toBeUndefined()
  })

  // A plain `..` is normalized away before anything reads the disk, so what
  // is left is a path under the root and the router answers it.
  it.each(["/../../etc/passwd", "/assets/../../secret"])(
    "normalizes %s to a path under the root",
    (url) => {
      const root = built()
      expect(assetFor(root, url)).toBe(resolve(root, "index.html"))
    },
  )

  // The encoded form outlives that normalizing and is decoded after it,
  // which is the one way a static server hands out the whole disk.
  it.each(["/..%2f..%2fetc%2fpasswd", "/assets%2f..%2f..%2fsecret"])(
    "hands out nothing above the root for %s",
    (url) => {
      expect(assetFor(built(), url)).toBeUndefined()
    },
  )

  it("hands out nothing for a path that is not valid encoding", () => {
    expect(assetFor(built(), "/%zz")).toBeUndefined()
  })

  // Every route falls back to the page, so a tree with no page must answer
  // with nothing at all rather than with the first file it finds.
  it("answers nothing at all when no build has left a page", () => {
    const root = mkdtempSync(join(tmpdir(), "eva-web-empty-"))
    expect(hasPage(root)).toBe(false)
    expect(assetFor(root, "/")).toBeUndefined()
    expect(assetFor(root, "/sessions/019a")).toBeUndefined()
  })
})

describe("the media type", () => {
  it.each([
    ["index.html", "text/html; charset=utf-8"],
    ["index-abc123.js", "text/javascript; charset=utf-8"],
    ["index-abc123.css", "text/css; charset=utf-8"],
    ["mark.svg", "image/svg+xml"],
  ])("names %s as %s", (name, type) => {
    expect(mediaType(name)).toBe(type)
  })

  // Guessed types are how a page ends up executing a font.
  it("answers an extension it does not know with bytes", () => {
    expect(mediaType("archive.tar.zst")).toBe("application/octet-stream")
  })
})

describe("the unbuilt notice", () => {
  it("names the tree it looked in and the command that fills it", () => {
    const said = unbuilt("/eva/apps/web/dist", "/usr/local/bin/bun")
    expect(said).toContain("/eva/apps/web/dist")
    expect(said).toContain("vp run -r build")
  })

  // Somebody who installed a binary has no workspace and no `vp`, so a build
  // command is a step they cannot take.
  it("names no build command to a run that is not from source", () => {
    const said = unbuilt("/opt/eva/eva-page", "/opt/homebrew/bin/eva")
    expect(said).toContain("/opt/eva/eva-page")
    expect(said).not.toContain("vp run -r build")
    expect(said).toContain("use the terminal")
  })

  it("reads a source run off the runtime that is executing it", () => {
    expect(fromSource("/usr/local/bin/node")).toBe(true)
    expect(fromSource("/opt/homebrew/bin/eva")).toBe(false)
  })
})
