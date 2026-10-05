// Leave one tab in the QA browser: the QA tab the scripts reuse (or, if it is gone, the first tab).
// Tabs pile up when the browser is restarted with a restored session. This closes EVERY other tab of
// the QA browser, so do not run it while the person has tabs of their own open there.
// usage: node tools/agent/qa/close-extra-pages.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { CDP } from './browser.mjs'
const browser = await chromium.connectOverCDP(CDP)
const session = await browser.newBrowserCDPSession()
const tabs = (await session.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page')
let known = null
try { known = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.fira-agent', 'qa-tab.json'), 'utf8')).targetId } catch { /* none remembered */ }
const keep = tabs.find((t) => t.targetId === known) ?? tabs[0]
let closed = 0
for (const t of tabs) {
  if (t === keep) continue
  await session.send('Target.closeTarget', { targetId: t.targetId }).then(() => closed++).catch(() => {})
}
console.log('kept', keep?.url ?? '-', 'closed', closed)
process.exit(0)
