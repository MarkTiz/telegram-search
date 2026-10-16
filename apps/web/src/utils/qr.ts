import { renderSVG } from '../vendor/uqr'

/** Render a Telegram login token URL as an SVG data URL for <img src>. */
export function loginTokenToQrDataUrl(url: string): string {
  const svg = renderSVG(url, {
    ecc: 'M',
    border: 2,
  })
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
