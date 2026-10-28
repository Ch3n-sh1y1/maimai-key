/**
 * Title layout regression:
 * - five menu actions in the requested order, all on the left
 * - the game name sits to the right
 * - Esc goes back from select/settings/creator
 * - the browser-only exit entry is disabled and labelled Esc
 */
const { chromium } = require('playwright-core');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://localhost:5173/';

async function main() {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('.title-screen');

  const layout = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.title-menu .menu button')];
    const brand = document.querySelector('.brand')?.getBoundingClientRect();
    const panel = document.querySelector('.title-menu')?.getBoundingClientRect();
    return {
      labels: buttons.map((button) => button.innerText.replace(/\s+/g, ' ').trim()),
      disabled: buttons.map((button) => button.disabled),
      lefts: buttons.map((button) => Math.round(button.getBoundingClientRect().left)),
      tops: buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
      widths: buttons.map((button) => Math.round(button.getBoundingClientRect().width)),
      panel: panel ? { x: Math.round(panel.x), right: Math.round(panel.right) } : null,
      brand: brand ? { x: Math.round(brand.x), width: Math.round(brand.width) } : null,
    };
  });

  await page.click('.title-menu [data-action="start"]');
  await page.waitForSelector('.select-screen');
  const selectBack = await page.locator('.select-screen [data-action="title"]').innerText();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.title-screen');

  await page.click('.title-menu [data-action="settings"]');
  await page.waitForSelector('.settings-screen');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.title-screen');

  await page.click('.title-menu [data-action="creator"]');
  await page.waitForSelector('.creator-screen');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.title-screen');

  await page.hover('.title-menu [data-action="start"]');
  await page.waitForTimeout(400);
  const hover = await page.evaluate(() => {
    const button = document.querySelector('.title-menu [data-action="start"]');
    const label = button?.querySelector('span');
    const style = button ? getComputedStyle(button) : null;
    const underline = label ? getComputedStyle(label, '::after').width : '0px';
    return {
      background: style?.backgroundColor,
      border: style?.borderTopWidth,
      transform: style?.transform,
      underline,
      color: style?.color,
    };
  });

  const expected = ['开始游戏 Enter', '自动打谱 C', '背景 B', '设置 S', '退出 Esc'];
  const sameLeft = new Set(layout.lefts).size === 1;
  const ascending = layout.tops.every((top, index) => index === 0 || top > layout.tops[index - 1]);
  const brandRight = Boolean(
    layout.panel && layout.brand && layout.brand.x > layout.panel.right && layout.brand.width > 240,
  );
  const orderOk = expected.every((label, index) => layout.labels[index] === label);
  const exitEsc = layout.labels[4]?.endsWith('Esc') && layout.disabled[4] === true;
  const selectBackEsc = selectBack.includes('主页') && selectBack.includes('Esc');
  const openStyle =
    hover.background === 'rgba(0, 0, 0, 0)' &&
    hover.border === '0px' &&
    hover.transform !== 'none' &&
    hover.underline !== '0px' &&
    hover.color === 'rgb(255, 255, 255)';

  const ok =
    errors.length === 0 &&
    orderOk &&
    sameLeft &&
    ascending &&
    brandRight &&
    exitEsc &&
    selectBackEsc &&
    openStyle &&
    layout.widths.every((width) => width > 240);
  console.log(
    JSON.stringify(
      { layout, hover, selectBack, checks: { orderOk, sameLeft, ascending, brandRight, exitEsc, selectBackEsc, openStyle }, errors },
      null,
      2,
    ),
  );
  await browser.close();
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
