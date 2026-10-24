// Renders public/og.png, the link preview for LinkedIn and other sites.
// Usage: VITE_BASEMAP_STYLE=blank npm run build && npx vite preview --port 4180, then
// node scripts/og-image.cjs. The counts come from the built data, never typed in.
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')
const data = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', f), 'utf8'))
const blocks = data('paris_h3.geojson').features.length.toLocaleString('en-GB')
const boutiques = data('luxury_stores.geojson').features.length.toLocaleString('en-GB')
;(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
  const m = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 })
  await m.goto('http://localhost:4180/#profile=fashion-house')
  await m.waitForTimeout(3000)
  await m.addStyleTag({
    content: '.panel{display:none!important}.maplibregl-control-container{display:none!important}',
  })
  await m.waitForTimeout(500)
  const shot = (await m.screenshot({ clip: { x: 300, y: 150, width: 700, height: 630 } })).toString('base64')
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } })
  await p.setContent(`<html><head><link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,500&family=IBM+Plex+Mono:wght@500&display=swap" rel="stylesheet"></head>
  <body style="margin:0;width:1200px;height:630px;display:grid;grid-template-columns:520px 680px;background:#eef0ee;color:#121816">
  <div style="padding:64px 48px;display:flex;flex-direction:column;justify-content:space-between">
   <div><div style="font:500 14px 'IBM Plex Mono',monospace;letter-spacing:.1em;color:#5a6866">ADRESSE · PARIS</div>
   <div style="font:500 52px/1.08 Newsreader,Georgia,serif;margin-top:24px">Where should a luxury brand open its next boutique?</div></div>
   <div style="font:500 15px/1.6 'IBM Plex Mono',monospace;color:#1f5c63">${blocks} blocks scored · ${boutiques} boutiques<br>open data · explained scores</div>
  </div>
  <div style="background:url(data:image/png;base64,${shot}) center/cover"></div></body></html>`)
  await p.waitForTimeout(1500)
  await p.screenshot({ path: path.join(__dirname, '..', 'public', 'og.png') })
  await b.close()
})()
