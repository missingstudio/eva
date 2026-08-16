/**
 * Tell the engines that accept IndexNow which URLs changed, instead of waiting
 * for a crawl.
 *
 * Be clear about the reach: IndexNow is Bing, Yandex, Seznam, and Naver.
 * Google does not consume it. It is worth running because Bing's index feeds
 * several answer engines, not because it is a general-purpose ping.
 *
 * The key is not a secret — the protocol requires it to be served publicly at
 * https://<host>/<key>.txt, containing the key and nothing else. Two steps to
 * turn this on, once:
 *
 *   1. Choose a key (a UUID is fine) and write it to
 *      packages/brand/public/<key>.txt, whose only content is the key. Both
 *      sites serve that directory, so one file covers both hosts.
 *   2. Export INDEXNOW_KEY with the same value wherever this runs.
 *
 * Without INDEXNOW_KEY this script does nothing and says so, so it is safe to
 * put in a deploy step before anyone has configured it.
 *
 *   bun scripts/indexnow.ts                  # every URL in both sitemaps
 *   bun scripts/indexnow.ts <url> [url...]   # only these
 */
const key = process.env["INDEXNOW_KEY"]

if (!key) {
  console.log("indexnow: INDEXNOW_KEY is not set, so nothing was submitted.")
  process.exit(0)
}

const hosts = ["https://missing.studio", "https://docs.missing.studio"] as const

const sitemapUrls = async (origin: string): Promise<string[]> => {
  const response = await fetch(`${origin}/sitemap.xml`)
  if (!response.ok) {
    console.warn(`indexnow: ${origin}/sitemap.xml answered ${response.status}, skipping it.`)
    return []
  }

  const xml = await response.text()
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, url]) => url!)
}

/** One request per host: the protocol scopes a submission to a single host. */
const submit = async (host: string, urlList: string[]) => {
  const response = await fetch("https://api.indexnow.org/IndexNow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: new URL(host).host,
      key,
      keyLocation: `${host}/${key}.txt`,
      urlList,
    }),
  })

  // 200 accepted, 202 accepted but the key is still being verified. Anything
  // else is worth reading rather than passing over.
  const outcome = response.ok ? "accepted" : `refused (${response.status})`
  console.log(`indexnow: ${host} — ${urlList.length} URLs ${outcome}`)

  return response.ok
}

const requested = process.argv.slice(2)

const byHost = await Promise.all(
  hosts.map(async (host) => ({
    host,
    urls:
      requested.length > 0
        ? requested.filter((url) => url.startsWith(host))
        : await sitemapUrls(host),
  })),
)

const results = await Promise.all(
  byHost.filter(({ urls }) => urls.length > 0).map(({ host, urls }) => submit(host, urls)),
)

if (results.includes(false)) process.exit(1)
