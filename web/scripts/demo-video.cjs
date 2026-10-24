// Records the demo walkthrough as a video, at phone and desktop size.
// Usage: npm run build && npx vite preview --port 4180, then
// node scripts/demo-video.cjs [outDir]. Writes demo-phone.webm and demo-desktop.webm.
// The captions only describe what is on screen: every number in the video is read
// from the app itself, which reads it from the data.
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const URL = process.env.DEMO_URL ?? 'http://localhost:4180/'
const OUT = path.resolve(process.argv[2] ?? 'demo')
const SIZES = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 720 },
}

async function caption(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById('demo-caption')
    if (!el) {
      el = document.createElement('div')
      el.id = 'demo-caption'
      el.style.cssText =
        'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:100;max-width:90%;' +
        'padding:8px 14px;font:500 15px/1.35 "IBM Plex Sans",sans-serif;color:#eef0ee;' +
        'background:rgba(18,24,22,.88);text-align:center;pointer-events:none'
      document.body.appendChild(el)
    }
    el.textContent = t
  }, text)
}

async function tour(page, phone) {
  const pause = (ms) => page.waitForTimeout(ms)
  await page.goto(`${URL}#profile=fashion-house`)
  await page.waitForSelector('.chip')
  await pause(2500)
  await caption(page, 'Adresse: where should a luxury brand open its next Paris boutique?')
  await pause(3500)
  await caption(page, 'Every block of Paris, scored from open data for three kinds of brand')
  await page.click('#profile-beauty')
  await pause(3000)

  await caption(page, 'Ask Adresse: each answer comes from real queries on the data')
  await page.click('.ask-open')
  await page.waitForSelector('.ask-question')
  await pause(2000)
  await page.click('text=Where could a beauty brand open, away from its competitors?')
  await pause(4500)
  await page.locator('.ask-a summary').last().click()
  await caption(page, 'The queries behind the answer, with their results')
  await pause(4000)
  await page.locator('.ask-thread > li').last().locator('text=Show on the map').click()
  await caption(page, 'The answer on the map, with the reasons behind the score')
  await pause(5000)
  if (phone) await page.locator('.panel').evaluate((el) => el.scrollTo({ top: 400, behavior: 'smooth' }))
  await pause(3000)

  await caption(page, 'A one-page site memo, ready to print or share')
  await page.locator('.panel >> text=Site memo').first().click()
  await page.waitForSelector('.memo')
  await pause(4500)
  await page.keyboard.press('Escape')
  await pause(800)

  await caption(page, 'How it works: tested on brands the model never saw')
  await page.click('.method-link')
  await page.waitForSelector('.method')
  await pause(1500)
  await page.locator('.method').evaluate((el) => el.scrollTo({ top: el.scrollHeight * 0.35, behavior: 'smooth' }))
  await pause(4000)
  await caption(page, 'Open source, built only from open data')
  await pause(3000)
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {})
  for (const [name, size] of Object.entries(SIZES)) {
    const context = await browser.newContext({
      viewport: size,
      deviceScaleFactor: 1,
      isMobile: name === 'phone',
      hasTouch: name === 'phone',
      recordVideo: { dir: OUT, size },
    })
    const page = await context.newPage()
    await tour(page, name === 'phone')
    const video = page.video()
    await context.close()
    fs.renameSync(await video.path(), path.join(OUT, `demo-${name}.webm`))
    console.log(`recorded demo-${name}.webm`)
  }
  await browser.close()
})()
