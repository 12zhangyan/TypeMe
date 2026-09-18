// Curated local images only. Missing artwork uses the designed SVG fallback, without 404 requests.
// Add files using the names in assets/illustrations/README.md, then rebuild.
const files = import.meta.glob<string>('../assets/illustrations/*.{webp,png,avif}', {
  eager: true, import: 'default', query: '?url',
})
export function illustrationAsset(name: string): string | undefined {
  for (const extension of ['webp', 'avif', 'png']) {
    const url = files[`../assets/illustrations/${name}.${extension}`]
    if (url) return url
  }
  return undefined
}
