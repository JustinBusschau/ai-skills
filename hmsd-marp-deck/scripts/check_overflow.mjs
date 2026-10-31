#!/usr/bin/env node
// Report Marp slides whose content runs past the slide's bottom or right edge,
// or spills out of a fixed-height box (such as a title on two lines).
//
// Usage: node check_overflow.mjs <deck.bare.html>
//
// Expects HTML rendered with `marp --template bare`, so every slide is laid
// out at once. Needs puppeteer or puppeteer-core; it looks for a global
// install, then for the copy bundled with @mermaid-js/mermaid-cli.
//
// Exit codes: 0 no overflow, 5 overflow found, 2 usage error, 3 the check
// could not run (no puppeteer or no launchable browser). A skipped check is
// never reported as a pass.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('usage: check_overflow.mjs <deck.bare.html>');
  process.exit(2);
}

function findPuppeteer() {
  const roots = [];
  try { roots.push(execSync('npm root -g', { encoding: 'utf8' }).trim()); } catch {}
  try {
    const mmdc = realpathSync(execSync('command -v mmdc', { encoding: 'utf8', shell: '/bin/sh' }).trim());
    // .../node_modules/@mermaid-js/mermaid-cli/src/cli.js -> package root
    let dir = dirname(mmdc);
    while (dir !== '/' && !existsSync(join(dir, 'package.json'))) dir = dirname(dir);
    roots.push(join(dir, 'node_modules'));
  } catch {}
  roots.push('/opt/homebrew/lib/node_modules/@mermaid-js/mermaid-cli/node_modules');
  for (const root of roots) {
    for (const name of ['puppeteer', 'puppeteer-core']) {
      const pkg = join(root, name, 'package.json');
      if (existsSync(pkg)) return { req: createRequire(pkg), name };
    }
  }
  return null;
}

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find(existsSync);
}

const found = findPuppeteer();
if (!found) {
  console.warn('OVERFLOW CHECK DID NOT RUN: puppeteer not found. Inspect every PNG preview instead.');
  process.exit(3);
}
const mod = found.req(found.name);
const puppeteer = mod.default ?? mod;

let browser;
try {
  const opts = { headless: true, args: ['--no-sandbox'] };
  const exe = chromePath();
  if (exe) opts.executablePath = exe;
  browser = await puppeteer.launch(opts);
} catch (err) {
  console.warn(`OVERFLOW CHECK DID NOT RUN: could not launch a browser (${err.message.split('\n')[0]}). Inspect every PNG preview instead.`);
  process.exit(3);
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(pathToFileURL(resolve(file)).href, { waitUntil: 'networkidle0' });

  const problems = await page.evaluate(() => {
    const out = [];
    // Content entering the slide's padding counts as overflow, because that is
    // where the footer and page number sit. A few pixels of tolerance absorb
    // descenders and rounding.
    const TOLERANCE = 6;
    const slides = [...document.querySelectorAll('section')].filter(
      (s) => !s.closest('section section') &&
        !['background', 'pseudo'].includes(s.dataset.marpitAdvancedBackground)
    );
    slides.forEach((section, i) => {
      const box = section.getBoundingClientRect();
      const style = getComputedStyle(section);
      const limitTop = box.top + (parseFloat(style.paddingTop) || 0) - TOLERANCE;
      const limitBottom = box.bottom - (parseFloat(style.paddingBottom) || 0) + TOLERANCE;
      const limitRight = box.right - (parseFloat(style.paddingRight) || 0) + TOLERANCE;
      let worstY = 0;
      let worstX = 0;
      let worstZ = 0;
      let culprit = '';
      for (const el of section.querySelectorAll('*')) {
        if (el.closest('footer, header')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const dy = Math.max(r.bottom - limitBottom, limitTop - r.top);
        // Text that cannot wrap (titles are nowrap) spills out of its own box
        // without widening it, so measure the scrolled width as well.
        const spill = el.scrollWidth > el.clientWidth ? el.scrollWidth - el.clientWidth : 0;
        const dx = r.right + spill - limitRight;
        // Content taller than a fixed-height box (a title forced onto a second
        // line) runs over whatever sits below it without leaving the slide.
        const dz = el.clientHeight > 0 ? el.scrollHeight - el.clientHeight - TOLERANCE : 0;
        if (dy > worstY) { worstY = dy; culprit = el.tagName.toLowerCase(); }
        if (dx > worstX) { worstX = dx; culprit ||= el.tagName.toLowerCase(); }
        if (dz > worstZ) { worstZ = dz; culprit ||= el.tagName.toLowerCase(); }
      }
      const title = section.querySelector('h1, h2')?.textContent.trim() ?? '(untitled)';
      if (worstY > 0 || worstX > 0 || worstZ > 0) {
        out.push({ slide: i + 1, title, overflowY: Math.round(worstY), overflowX: Math.round(worstX), spill: Math.round(worstZ), culprit });
      }
    });
    return { count: slides.length, out };
  });

  if (problems.out.length === 0) {
    console.log(`overflow check: ${problems.count} slides, none overflow.`);
  } else {
    console.log(`overflow check: ${problems.out.length} of ${problems.count} slides overflow:`);
    for (const p of problems.out) {
      const parts = [];
      if (p.overflowY) parts.push(`${p.overflowY}px too tall`);
      if (p.overflowX) parts.push(`${p.overflowX}px past right`);
      if (p.spill) parts.push(`${p.spill}px spilling out of its box onto the content below (a title on two lines, if the element is h1)`);
      console.log(`  slide ${p.slide} "${p.title}": ${parts.join(', ')} (worst element: ${p.culprit})`);
    }
    process.exitCode = 5;
  }
} finally {
  await browser.close();
}
