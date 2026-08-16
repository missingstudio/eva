/**
 * The theme preference, shared by both sites.
 *
 * A cookie rather than local storage, because local storage is per origin and
 * the two sites are two origins. Scoped to the parent domain so a person who
 * picks dark on the marketing site arrives at the documentation in dark.
 *
 * The documentation site runs next-themes underneath Fumadocs, which reads
 * local storage and knows nothing about the cookie. Rather than replace it,
 * the two are kept in step: the pre-paint script below copies the cookie into
 * the key next-themes reads, so next-themes agrees with the cookie before it
 * boots, and `applyTheme` writes both. The cookie stays the source of truth,
 * because it is the only one that crosses an origin.
 */
export const themeCookie = "eva-theme"

/** The key next-themes reads. Its default, and it is not configured away. */
const themeStorageKey = "theme"

export type Theme = "light" | "dark" | "system"

const isTheme = (value: unknown): value is Theme =>
  value === "light" || value === "dark" || value === "system"

/**
 * The no-flash script. It runs before paint, in the document head, so the page
 * never renders in the wrong scheme and then corrects itself.
 *
 * It is a string rather than a module because it has to execute before any
 * bundle loads. Keep it small enough to read in one go.
 */
export const themeScript = `(function(){try{
var m=document.cookie.match(/(?:^|; )${themeCookie}=([^;]*)/);
var t=m?decodeURIComponent(m[1]):null;
if(t!=="dark"&&t!=="light"&&t!=="system"){try{t=localStorage.getItem("${themeStorageKey}")}catch(e){}}
if(t!=="dark"&&t!=="light"&&t!=="system"){t="system";}
try{localStorage.setItem("${themeStorageKey}",t)}catch(e){}
var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.classList.toggle("dark",d);
}catch(e){}})()`

const cookieDomain = (host: string) =>
  host.endsWith("missing.studio") ? "; domain=.missing.studio" : ""

export const readTheme = (): Theme => {
  const match = document.cookie.match(new RegExp(`(?:^|; )${themeCookie}=([^;]*)`))
  const value = match?.[1] ? decodeURIComponent(match[1]) : undefined
  return isTheme(value) ? value : "system"
}

/** Write the preference to the cookie, and to the key next-themes reads. */
export const storeTheme = (theme: Theme): void => {
  const year = 60 * 60 * 24 * 365
  document.cookie = `${themeCookie}=${theme}; path=/; max-age=${year}; samesite=lax${cookieDomain(location.hostname)}`
  try {
    localStorage.setItem(themeStorageKey, theme)
  } catch {
    // A browser with storage denied still gets the cookie, which is the one
    // that matters. Nothing here is worth failing a theme change over.
  }
}

export const applyTheme = (theme: Theme): void => {
  const dark =
    theme === "dark" ||
    (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches)

  const root = document.documentElement

  // Every colour on the page changes at once. Without this the whole page
  // animates that repaint for the length of its longest colour transition and
  // wipes through an intermediate palette on the way. The attribute suppresses
  // transitions, the reflow makes the suppression take effect before the class
  // flips, and two frames later it is released — one frame is not enough,
  // because the style change lands in the first.
  root.setAttribute("data-theme-changing", "")
  void root.offsetWidth

  root.classList.toggle("dark", dark)
  storeTheme(theme)

  requestAnimationFrame(() =>
    requestAnimationFrame(() => root.removeAttribute("data-theme-changing")),
  )
}
