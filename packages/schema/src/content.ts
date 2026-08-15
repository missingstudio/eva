import { z } from "zod"
import type { ContentBlock, EmbeddedResource } from "./payload.js"

/**
 * The content block, in the two shapes it is read in.
 *
 * `contentBlock` validates a record Eva wrote: an unknown key is corruption,
 * and an absent field is absent. `readContentBlock` accepts what a vendor
 * sends — the extra keys the wire carries, and `null` for a field it has
 * nothing to say about — and returns the union member.
 *
 * Both produce `ContentBlock`, so the union stays the one place the variants
 * and their fields are declared. A reader that walked the variants a third
 * time by hand is what this module replaces.
 */

const wireResource = z.union([
  z.strictObject({ uri: z.string(), mimeType: z.string().exactOptional(), text: z.string() }),
  z.strictObject({ uri: z.string(), mimeType: z.string().exactOptional(), blob: z.string() }),
])

export const contentBlock = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("text"), text: z.string() }),
  z.strictObject({
    type: z.literal("image"),
    data: z.string(),
    mimeType: z.string(),
    uri: z.string().exactOptional(),
  }),
  z.strictObject({ type: z.literal("audio"), data: z.string(), mimeType: z.string() }),
  z.strictObject({
    type: z.literal("resource_link"),
    uri: z.string(),
    name: z.string(),
    mimeType: z.string().exactOptional(),
    size: z.number().int().nonnegative().exactOptional(),
  }),
  z.strictObject({ type: z.literal("resource"), resource: wireResource }),
])

const foreignResource = z.union([
  z.object({ uri: z.string(), mimeType: z.string().nullish(), text: z.string() }),
  z.object({ uri: z.string(), mimeType: z.string().nullish(), blob: z.string() }),
])

const resource = (value: z.infer<typeof foreignResource>): EmbeddedResource => {
  const body = "text" in value ? { text: value.text } : { blob: value.blob }
  return value.mimeType == null
    ? { uri: value.uri, ...body }
    : { uri: value.uri, mimeType: value.mimeType, ...body }
}

export const readContentBlock = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: z.string() }),
    z.object({
      type: z.literal("image"),
      data: z.string(),
      mimeType: z.string(),
      uri: z.string().nullish(),
    }),
    z.object({ type: z.literal("audio"), data: z.string(), mimeType: z.string() }),
    z.object({
      type: z.literal("resource_link"),
      uri: z.string(),
      name: z.string(),
      mimeType: z.string().nullish(),
      size: z.number().int().nonnegative().nullish(),
    }),
    z.object({ type: z.literal("resource"), resource: foreignResource }),
  ])
  // The annotated return type is the tie: a variant that drifts from the
  // union fails here rather than at a reader that trusted the type.
  .transform((value): ContentBlock => {
    switch (value.type) {
      case "text":
        return { type: "text", text: value.text }
      case "image":
        return {
          type: "image",
          data: value.data,
          mimeType: value.mimeType,
          ...(value.uri == null ? {} : { uri: value.uri }),
        }
      case "audio":
        return { type: "audio", data: value.data, mimeType: value.mimeType }
      case "resource_link":
        return {
          type: "resource_link",
          uri: value.uri,
          name: value.name,
          ...(value.mimeType == null ? {} : { mimeType: value.mimeType }),
          ...(value.size == null ? {} : { size: value.size }),
        }
      case "resource":
        return { type: "resource", resource: resource(value.resource) }
    }
  })
