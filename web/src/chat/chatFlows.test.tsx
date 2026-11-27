import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test';
import chat from '../../e2e/fixtures/chat.json';
import earlier from '../../e2e/fixtures/earlier.json';
import live from '../../e2e/fixtures/live.json';
import spawned from '../../e2e/fixtures/spawned.json';

// The chat view rendered in happy-dom against the e2e fixtures; every server call goes to the fake fetch below.
GlobalRegistrator.register({ url: 'http://localhost/', width: 1280, height: 800 });
// Timers the app left behind (a closed layer's history trim) must not fire into the next test file of this process.
afterAll(async () => {
  await (window as unknown as { happyDOM: { abort: () => Promise<void> } }).happyDOM.abort();
  await GlobalRegistrator.unregister();
});

const sent: { type: string; [k: string]: unknown }[] = [];
const fetched: string[] = [];
const routes: Record<string, (u: URL) => unknown> = {
  '/api/chat/events': () => earlier,
  '/api/chat/spawned': (u) => (u.searchParams.get('session') === 's1' ? spawned : []),
  '/api/git/status': () => ({ branch: 'main', ahead: 0, behind: 0, files: [] }),
  '/api/assistant/changes': () => ({ version: 1, changes: [] }),
  '/api/paste': () => ({ path: '/tmp/notes.txt' }),
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = new URL(String(input), location.href);
  fetched.push(u.pathname + u.search);
  if (u.pathname === '/api/cmd') sent.push(JSON.parse(String(init?.body)));
  return Response.json(routes[u.pathname]?.(u) ?? (u.pathname === '/api/cmd' ? { ok: true } : []));
}) as typeof fetch;

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import('@testing-library/react');
const { handle } = await import('../app/store/handlers');
const { setUi } = await import('../app/store');
const { Brief } = await import('../sessions/brief/Brief');
const { SnackBar } = await import('../codex/tasks/SnackBar');

const copied: string[] = [];
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void copied.push(t) }, configurable: true });

const base = Date.now() - 60_000;
const at = <T extends { at: number }>(list: T[]) => list.map((e) => ({ ...e, at: base + e.at }));
routes['/api/chat/events'] = () => ({ ...earlier, events: at(earlier.events) });

function open(patch: Record<string, unknown> = {}) {
  act(() => {
    // A blank chat first, so the fixture's init stands alone instead of merging with rows an earlier test paged in.
    handle({ type: 'init', state: { ...chat, events: [], earlier: 0, session: { ...chat.session, id: 'blank' } } } as never);
    handle({ type: 'init', state: { ...chat, events: at(chat.events), session: { ...chat.session, ...patch } } } as never);
    handle({ type: 'live', chats: live } as never);
    setUi({ connected: true });
  });
  const view = render(<><Brief /><SnackBar /></>);
  return { ...view, tr: view.container.querySelector<HTMLElement>('.tr')! };
}

const turn = (id: string) => document.querySelector<HTMLElement>(`[id="turn-work:${id}"]`)!;
const userRow = (text: string) => screen.getByText(text, { selector: '.tr-user-text div' }).closest<HTMLElement>('.tr-user')!;
const lastSent = (type: string) => waitFor(() => { const m = sent.findLast((c) => c.type === type); expect(m).toBeDefined(); return m!; });

beforeEach(() => { sent.length = 0; fetched.length = 0; copied.length = 0; });
afterEach(() => cleanup());

const button = (name: string | RegExp, within_: HTMLElement = document.body) => within(within_).getByRole('button', { name });
const box = () => document.querySelector<HTMLTextAreaElement>('.brief textarea')!;
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const tools = () => waitFor(() => { const el = document.querySelector<HTMLElement>('.page-work'); expect(el).not.toBeNull(); return el!; });

describe('chat view', () => {
  it('shows the prompts, the reply and its code', async () => {
    open();
    expect(userRow('Fix the login bug')).toBeTruthy();
    expect(userRow('Now run the tests')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.tr-assistant pre')?.textContent).toContain('const ttl = 3600;'));
    expect(document.body.textContent).toContain('signed in for an hour');
  });

  it('sends a prompt when the chat is idle', async () => {
    open({ running: false });
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(button('Send').hasAttribute('disabled')).toBe(true);
    type('Add a test for the login');
    fireEvent.click(button('Send'));
    expect(await lastSent('prompt')).toMatchObject({ text: 'Add a test for the login' });
    await waitFor(() => expect(box().value).toBe(''));
  });

  it('queues a message while the turn runs', async () => {
    open();
    type('Also check the logout');
    fireEvent.click(button('Send'));
    expect(await lastSent('queue')).toMatchObject({ text: 'Also check the logout' });
  });

  it('stops the running turn', async () => {
    open();
    fireEvent.click(button('Stop'));
    await lastSent('interrupt');
  });

  it('reuses a prompt and copies a reply', async () => {
    open();
    fireEvent.click(button('Use again', userRow('Now run the tests')));
    await waitFor(() => expect(box().value).toBe('Now run the tests'));
    const reply = document.querySelector<HTMLElement>('[id="turn-a1"] .tr-acts')!;
    fireEvent.click(button('Copy', reply));
    await waitFor(() => expect(copied[0]).toContain('const ttl = 3600;'));
    await screen.findByText('Reply copied');
  });

  it('opens the chat settings from the mode chip and closes it with Escape', async () => {
    open();
    fireEvent.click(document.querySelector('.cp-mode')!);
    const menu = await screen.findByRole('dialog', { name: 'Chat settings' });
    expect(menu.textContent).toContain('Permission mode');
    expect(menu.textContent).toContain('Find in chat');
    fireEvent.keyDown(within(menu).getByRole('textbox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chat settings' })).toBeNull());
  });

  it('lists commands after a slash', async () => {
    open();
    type('/rev');
    const list = await screen.findByRole('listbox', { name: 'Commands' });
    expect(list.textContent).toContain('review');
    type('');
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Commands' })).toBeNull());
  });

  it('shows an attached file as a chip that removes it', async () => {
    open();
    const input = document.querySelector<HTMLInputElement>('.brief input[type=file]')!;
    fireEvent.change(input, { target: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] } });
    const chip = await screen.findByRole('button', { name: 'Remove file notes.txt' });
    fireEvent.click(chip);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove file notes.txt' })).toBeNull());
  });

  it('shows the task checklist of a done and a running turn', () => {
    open();
    expect(turn('u1').querySelector('.tr-steps-head')!.textContent).toContain('2 tasks');
    expect([...turn('u1').querySelectorAll('.tr-tasks li.done')].map((li) => li.textContent)).toEqual(['Read the code', 'Fix the bug']);
    expect(turn('u2').querySelector('.tr-steps-head')!.textContent).toContain('Tasks · 0 of 2');
    expect(turn('u2').querySelector('.tr-tasks li.now')!.textContent).toBe('Running the tests');
    expect(turn('u2').querySelector('.tr-tasks li:last-child')!.textContent).toBe('Report');
  });

  it('opens and closes the claims a turn read', () => {
    open();
    const chip = button('Used 2 claims', turn('u1'));
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-expanded')).toBe('true');
    const claims = [...turn('u1').querySelectorAll('.tr-claims li')].map((li) => li.textContent);
    expect(claims).toHaveLength(2);
    expect(claims[0]).toContain('Login uses one session cookie');
    expect(claims[0]).toContain('(Auth · Gone)');
    fireEvent.click(chip);
    expect(turn('u1').querySelector('.tr-claims')).toBeNull();
  });

  it('opens a done turn\'s tool calls with the edit diff and counts', async () => {
    open();
    expect(turn('u1').querySelector('.tr-count .add')!.textContent).toBe('+3');
    expect(turn('u1').querySelector('.tr-count .del')!.textContent).toBe('−2');
    fireEvent.click(button(/Used 3 tools/, turn('u1')));
    const work = await tools();
    expect(work.textContent).toContain('What Claude did');
    expect(work.querySelectorAll('.tr-step.ok')).toHaveLength(2);
    const file = [...work.querySelectorAll<HTMLElement>('.tr-box')].find((b) => b.textContent!.includes('login.ts'))!;
    expect(file.querySelector('.tr-count')!.textContent).toBe('+3 −2');
    fireEvent.click(within(file).getAllByText('login.ts')[0]);
    await waitFor(() => expect(file.querySelector('.pd-diff')).not.toBeNull());
    expect([...file.querySelectorAll('.pd-diff .add')].map((d) => d.textContent)).toEqual(['+ const ttl = 3600;', '+ const user = find(id);', '+ return user;']);
    expect([...file.querySelectorAll('.pd-diff .del')].map((d) => d.textContent)).toEqual(['- const ttl = 0;', '- return null;']);
  });

  it('shows running and done tool rows, and a pushed result finishes the running one', async () => {
    open();
    const head = turn('u2').querySelector<HTMLElement>('.tr-tools')!;
    expect(head.textContent).toContain('Run e2e');
    fireEvent.click(head);
    const work = await tools();
    expect(work.textContent).toContain('What Claude is doing');
    expect(work.querySelector('.tr-step.ok')!.textContent).toContain('bun test');
    expect(work.querySelector('.tr-step.pending')!.textContent).toContain('bun run e2e');
    fireEvent.click(work.querySelector('.tr-step.ok .tr-text')!);
    expect(work.querySelector('.tr-step.ok .tr-detail')!.textContent).toContain('12 pass');
    act(() => handle({ type: 'event', event: { id: 'r9', kind: 'tool_result', toolUseId: 't9', text: '8 passed', isError: false, at: Date.now() } }));
    await waitFor(() => expect(work.querySelector('.tr-step.pending')).toBeNull());
    expect(work.querySelectorAll('.tr-step.ok')).toHaveLength(2);
  });

  it('loads earlier messages from Show earlier', async () => {
    const { tr } = open();
    const more = await waitFor(() => { const el = tr.querySelector<HTMLElement>('.tr-more'); expect(el?.textContent).toContain('Show earlier'); return el!; });
    fireEvent.click(more);
    await waitFor(() => expect(userRow('Look at the login page')).toBeTruthy());
    expect(fetched.some((u) => u.startsWith('/api/chat/events?before=ua'))).toBe(true);
    expect(tr.textContent).toContain('reads the session from a cookie');
    await waitFor(() => expect(tr.querySelector('.tr-more')).toBeNull());
  });

  it('finds in the chat from the settings menu', async () => {
    open();
    fireEvent.click(document.querySelector('.cp-mode')!);
    fireEvent.click(await screen.findByText('Find in chat'));
    const input = await screen.findByRole('textbox', { name: 'Find in chat' });
    await waitFor(() => expect(document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: 'login' } });
    expect(document.querySelector('.tr-find-count')!.textContent).toMatch(/of \d+/);
    expect(button('Next match').hasAttribute('disabled')).toBe(false);
    fireEvent.click(button('Next match'));
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(button('Load earlier')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.tr-find')).toBeNull());
  });

  it('shows the build run in the build bar and opens its chat', async () => {
    open();
    const row = await waitFor(() => { const el = document.querySelector<HTMLElement>('.tr-buildbar-row'); expect(el).not.toBeNull(); return el!; });
    expect(row.textContent).toContain('e2e suite');
    expect(row.textContent).toContain('Task 3 of 5 · round 3');
    expect(row.querySelector('.chat-run')!.textContent).toBe('Running');
    fireEvent.click(row);
    expect(await lastSent('view')).toEqual({ type: 'view', id: 'c2' });
  });
});

