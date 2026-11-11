// Images served without an Access-Control-Allow-Origin header display in the
// page but cannot be read by the screenshot library, which must fetch every
// image to inline it. For those the capture asks a public image proxy, which
// re-serves any public image with that header. wsrv.nl (formerly
// images.weserv.nl) has run since 2007, is free and open source, and is only
// contacted when the direct fetch has failed. Set the proxy to null to turn
// the fallback off; such images then appear as gray boxes.
export const IMAGE_PROXY_URL = "https://wsrv.nl/"

export function proxiedImageUrl(url, proxy = IMAGE_PROXY_URL) {
  const separator = proxy.includes("?") ? "&" : "?"
  return `${proxy}${separator}url=${encodeURIComponent(url)}`
}
