import { expect, test, type Locator, type Page } from '@playwright/test';

// Layout checks in a real browser, which happy-dom cannot measure. Clicks and flows are in web/src/chat/chatFlows.test.tsx.
// One page per project, loaded once; each test leaves it as it found it.

test.describe.configure({ mode: 'serial' });

let page: Page;
let phone = false;

test.beforeAll(async ({ browser }, info) => {
  phone = info.project.name === 'phone';
  page = await browser.newPage(info.project.use);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/?chat=c1');
  await expect(tr().locator('.tr-user').filter({ hasText: 'Now run the tests' })).toBeVisible();
});

test.afterAll(() => page.close());

const tr = () => page.locator('.brief .tr');

// The box lies fully inside the viewport, once its entry animation has ended.
async function inViewport(el: Locator) {
  await el.evaluate((n) => Promise.all(n.getAnimations().map((a) => a.finished)));
  const b = (await el.boundingBox())!;
  const v = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(v.width);
  expect(b.y + b.height).toBeLessThanOrEqual(v.height);
}

const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const scheme of ['light', 'dark'] as const) {
  test(`chat fits the screen in ${scheme}`, async () => {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    expect(await noSideScroll()).toBe(true);
    await inViewport(page.locator('.brief .timeline-head'));
    await inViewport(page.locator('.brief-input'));
    await inViewport(page.locator('.tr-buildbar-row'));
    // The transcript ends above the composer.
    const rows = (await tr().boundingBox())!;
    const input = (await page.locator('.brief-input').boundingBox())!;
    expect(rows.y + rows.height).toBeLessThanOrEqual(input.y + 1);
  });
}

test('the build task line shows the short title and ends above the transcript', async () => {
  const line = page.locator('.brief .tl-build');
  await expect(line).toHaveText('Task 3 of 9 · Clean up the session list');
  await expect(line).toHaveAttribute('title', /\(1\) a chat subtitle/);
  const b = (await line.boundingBox())!;
  const t = (await tr().boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual(t.y + 1);
  expect(await line.evaluate((n) => getComputedStyle(n).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
});

test('the header links the chat PR with its check state', async () => {
  const pr = page.locator('.brief .tl-pr');
  await expect(pr).toHaveText('#6 · Draft');
  await expect(pr).toHaveAttribute('href', 'https://github.com/o/r/pull/6');
  await expect(pr.locator('.gh-check.failure')).toBeVisible();
  await inViewport(pr);
});

test('the themes paint different backgrounds', async () => {
  const bg = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const dark = await bg();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await bg()).not.toBe(dark);
});

test('header status dropdown stays inside the viewport', async () => {
  const state = page.locator('.tl-state');
  await inViewport(state);
  await state.click();
  const pop = page.locator('.tl-pop');
  await expect(pop).toContainText('Run the tests');
  await inViewport(pop);
  await page.keyboard.press('Escape');
  await expect(pop).toBeHidden();
});

test('code block and edit counts stay inside the reply column', async () => {
  const code = tr().locator('[id="turn-a1"] pre').first();
  await code.scrollIntoViewIfNeeded();
  const col = (await tr().locator('.tr-rows').boundingBox())!;
  const b = (await code.boundingBox())!;
  expect(b.x).toBeGreaterThanOrEqual(col.x);
  expect(b.x + b.width).toBeLessThanOrEqual(col.x + col.width + 1);
  const counts = tr().locator('[id="turn-work:u1"] .tr-steps-head .tr-count');
  await counts.scrollIntoViewIfNeeded();
  const c = (await counts.boundingBox())!;
  expect(c.x + c.width).toBeLessThanOrEqual(col.x + col.width + 1);
});

test('reply code blocks use the code font size at a code line height', async () => {
  const code = tr().locator('[id="turn-a1"] pre code').first();
  const [size, pre, line] = await code.evaluate((n) => [parseFloat(getComputedStyle(n).fontSize), parseFloat(getComputedStyle(n.parentElement!).fontSize), parseFloat(getComputedStyle(n.parentElement!).lineHeight)]);
  expect(size).toBe(pre);
  expect(size).toBeGreaterThanOrEqual(12);
  expect(line).toBeLessThanOrEqual(size * 1.7);
});

test('jump to latest shows after scrolling up and returns to the end', async () => {
  const jump = page.locator('.tr-jump');
  await tr().evaluate((el) => el.scrollTo(0, 0));
  await expect(jump).toBeVisible();
  await inViewport(jump);
  await jump.click();
  await expect(jump).toBeHidden();
  await expect(tr().locator('.tr-user').filter({ hasText: 'Now run the tests' })).toBeInViewport();
});

test('tool calls open beside the chat or as their own screen', async () => {
  const fold = tr().locator('[id="turn-work:u1"] .tr-tools');
  await fold.scrollIntoViewIfNeeded();
  await fold.click();
  const work = page.locator('.page-work').filter({ hasText: 'What Claude did' }).last();
  await expect(work).toBeVisible();
  await inViewport(work.locator('.tr-box').filter({ hasText: 'login.ts' }));
  expect(await noSideScroll()).toBe(true);
  if (phone) {
    await work.getByRole('button', { name: 'Back' }).click();
  } else {
    // The rail sits right of the chat without covering it.
    const chat = (await page.locator('.brief').boundingBox())!;
    expect((await work.boundingBox())!.x).toBeGreaterThanOrEqual(chat.x + chat.width - 1);
    await page.getByRole('button', { name: 'Close tool calls' }).click();
  }
  await expect(work).toBeHidden();
});

test('top-left button toggles the sidebar', async () => {
  if (phone) {
    const chats = page.getByRole('button', { name: 'Chats', exact: true });
    await inViewport(chats);
    expect((await chats.boundingBox())!.x).toBeLessThan(60);
    await chats.click();
    await expect(page.locator('.ui-row-title').filter({ hasText: 'Build: e2e suite' })).toBeVisible();
    return;
  }
  const toggle = page.getByRole('button', { name: 'Hide the sidebar' });
  const b = (await toggle.boundingBox())!;
  expect(b.x).toBeLessThan(60);
  expect(b.y).toBeLessThan(60);
  const search = page.getByPlaceholder('Search repos and chats');
  const before = (await page.locator('.brief').boundingBox())!.width;
  await toggle.click();
  await expect(search).toBeHidden();
  expect((await page.locator('.brief').boundingBox())!.width).toBeGreaterThan(before);
  await page.getByRole('button', { name: 'Show the sidebar' }).click();
  await expect(search).toBeVisible();
});

test('session list rows stay one line each with the chat branch only', async () => {
  const rows = page.locator('.chats .chat-row');
  await expect(rows.filter({ hasText: 'Detached checkout' })).toBeVisible();
  const list = (await page.locator('.chats').boundingBox())!;
  for (const row of await rows.all()) {
    if (!(await row.isVisible())) continue;
    const title = row.locator('.ui-row-title');
    const h = await title.evaluate((n) => [n.getBoundingClientRect().height, parseFloat(getComputedStyle(n).lineHeight)]);
    expect(h[0]).toBeLessThanOrEqual(h[1] + 1);
    const b = (await row.boundingBox())!;
    expect(b.x + b.width).toBeLessThanOrEqual(list.x + list.width + 1);
  }
  // A build row under a chat keeps its state in the chat's column and its title no smaller than its meta.
  const state = async (row: Locator) => { const b = (await row.locator('.ui-row-state').first().boundingBox())!; return b.x + b.width; };
  const parent = rows.filter({ hasText: 'Fix the login bug' }).first();
  const child = page.locator('.chats .chat-build').filter({ hasText: 'e2e suite' }).first();
  expect(Math.abs((await state(parent)) - (await state(child)))).toBeLessThanOrEqual(1);
  const sizes = await child.evaluate((n) => ['.ui-row-title', '.ui-row-meta'].map((s) => parseFloat(getComputedStyle(n.querySelector(s)!).fontSize)));
  expect(sizes[0]).toBeGreaterThanOrEqual(sizes[1]);
  await expect(page.locator('.chats')).not.toContainText('worktree-agent');
  await expect(page.locator('.chats')).not.toContainText('HEAD');
  await expect(page.locator('.chats .chat-row .dot.idle').first()).toBeVisible();
  await expect(page.locator('.chats .chat-build .chat-run').filter({ hasText: 'Running' }).locator('.codicon, svg, i').first()).toBeVisible();
});

test('the activity bar menu lists each view on one line inside the menu', async () => {
  if (phone) return;
  await page.getByRole('button', { name: 'Explorer', exact: true }).click({ button: 'right' });
  const menu = page.getByRole('menu');
  await inViewport(menu);
  const box = (await menu.boundingBox())!;
  for (const item of await menu.getByRole('menuitem').all()) {
    const b = (await item.boundingBox())!;
    expect(b.height).toBeLessThanOrEqual(40);
    const icon = (await item.locator('.codicon').boundingBox())!;
    expect(icon.x).toBeGreaterThanOrEqual(box.x);
  }
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('Changes menus open beside their button without scrolling the page', async ({ browser }, info) => {
  const p = await browser.newPage(info.project.use);
  await p.goto('/?chat=c1');
  if (phone) {
    await p.getByRole('button', { name: 'More', exact: true }).last().click();
    await p.getByRole('button', { name: /Source control/ }).first().click();
  } else {
    await p.getByRole('button', { name: 'Source control', exact: true }).click();
  }
  const row = p.locator('.scm-row').filter({ hasText: 'login.ts' }).first();
  await expect(row).toBeVisible();
  const vw = p.viewportSize()!;
  const near = async (trigger: Locator) => {
    const menu = p.getByRole('menu');
    await expect(menu).toBeVisible();
    await menu.evaluate((n) => Promise.all(n.getAnimations().map((a) => a.finished)));
    const m = (await menu.boundingBox())!;
    const t = (await trigger.boundingBox())!;
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(vw.width);
    expect(m.y + m.height).toBeLessThanOrEqual(vw.height);
    if (!phone) expect(Math.abs(m.y - (t.y + t.height))).toBeLessThanOrEqual(8);
    expect(await p.evaluate(() => [scrollY, document.documentElement.scrollTop, document.body.scrollTop])).toEqual([0, 0, 0]);
    await p.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  };
  await row.hover();
  const more = row.getByRole('button', { name: 'More Actions' });
  await more.click();
  await near(more);
  const opts = p.getByRole('button', { name: 'Diff options' });
  await opts.click();
  await near(opts);
  // Touch rows keep their own actions and More; Open file and Mark as viewed are in More.
  if (phone) await expect(row.getByRole('button', { name: 'Open File' })).toBeHidden();
  const commits = (await p.locator('.scm-commits').boundingBox())!;
  const files = (await p.locator('.scm-commits + .gh-group').boundingBox())!;
  expect(Math.abs(commits.x - files.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(commits.width - files.width)).toBeLessThanOrEqual(1);
  await p.close();
});
