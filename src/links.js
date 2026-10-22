// The two reviewer links for a program: one per GuidedTrack mode.
export function shareLinks(pageUrl, shareId) {
  const base = `${pageUrl}?r=${encodeURIComponent(shareId)}&mode=`
  return { run: `${base}run`, test: `${base}test` }
}
