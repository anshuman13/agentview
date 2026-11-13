import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ADVISORS, moveBacklog, parseAudit, parseBacklog, type Advisor, type AdvisorId, type AdvisorInfo, type Audit, type BacklogItem } from '../../../shared/advisors.js';
import { listSessions, savedSession } from '../agent/claude/sessions.js';
import { ADVISOR_HOME, ROOTS } from '../workspace/files.js';

const ROLES = path.join(import.meta.dirname, '../../advisors');
const KIT = path.join(import.meta.dirname, '../../build-kit');
// What each advisor may write in any project: the PM its specs and backlog, the Designer its sketches and audits.
const WRITES: Partial<Record<AdvisorId, string[]>> = { pm: ['.claude/specs/**', '.claude/backlog.md'], designer: ['.claude/sketches/**', '.claude/audits/**'] };

export const advisor = (id: AdvisorId) => ADVISORS.find((a) => a.id === id);

const rules = `## Memory
memory.md in this folder is your memory across conversations and is loaded below. When you learn something that should outlast this conversation (a decision, a priority, a project fact, a preference of the user), update it in the same turn. Keep it under 150 lines: one line per fact, grouped by project, dated, oldest facts removed when they no longer hold.

@projects.md

@memory.md
`;

// The first sentence-like line of a README or CLAUDE.md: not a heading, badge, list item, table, quote or html.
const firstLine = (md: string) => {
  const line = md.split('\n').map((l) => l.trim()).find((l) => !/^(#|<|!\[|\[!|```|---|\||>|[-*] |\d+\.)/.test(l) && !/<br|&#|^\$ |guidance to Claude/.test(l) && l.split(/\s+/).length >= 5);
  const text = line?.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '') ?? '';
  return (/^.{20,160}?[.!?](\s|$)/.exec(text)?.[0] ?? text.slice(0, 160)).trim();
};

async function describe(dir: string) {
  for (const f of ['README.md', 'readme.md', 'CLAUDE.md']) {
    const line = firstLine(await readFile(path.join(dir, f), 'utf8').catch(() => ''));
    if (line) return line;
  }
  try {
    return String(JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')).description ?? '');
  } catch {
    return '';
  }
}

// One line per project folder under each root, newest activity first, so an advisor knows where to start reading.
export async function projectIndex(roots: string[]) {
  const groups = await Promise.all(roots.map(async (root) => {
    const names = await readdir(root, { withFileTypes: true }).catch(() => []);
    const rows = await Promise.all(names.filter((d) => d.isDirectory() && !d.name.startsWith('.')).map(async (d) => {
      const dir = path.join(root, d.name);
      const at = (await stat(path.join(dir, '.git/index')).catch(() => null))?.mtimeMs ?? 0;
      return { name: d.name, at, about: await describe(dir) };
    }));
    const date = (t: number) => (t ? ` (active ${new Date(t).toISOString().slice(0, 10)})` : '');
    return `### ${root}\n${rows.sort((x, y) => y.at - x.at).map((r) => `- ${r.name}${date(r.at)}${r.about ? `: ${r.about}` : ''}`).join('\n')}`;
  }));
  return `## Projects\nThe user's projects, one folder each under these roots, most recently active first. Read a project's CLAUDE.md before advising on it; ask which one when it is unclear.\n\n${groups.join('\n\n')}\n`;
}

let index: { at: number; text: Promise<string> } | null = null;
const cachedIndex = () => {
  if (!index || Date.now() - index.at > 10 * 60_000) {
    const text = projectIndex(ROOTS);
    index = { at: Date.now(), text };
    text.catch(() => index?.text === text && (index = null));
  }
  return index.text;
};

const writeIfChanged = async (file: string, text: string) => {
  if ((await readFile(file, 'utf8').catch(() => null)) !== text) await writeFile(file, text);
};

// Every root is readable; the PM and Designer may edit only their own paths in any project, the Architect nothing there.
// Its memory is in ~/.agentview, outside the roots. An edit elsewhere in a root is not allowed by a rule.
const settings = (a: Advisor, roots: string[]) => {
  const w = WRITES[a.id];
  const read = roots.map((r) => `Read(/${r}/**)`);
  return { permissions: w ? { allow: [...read, ...roots.flatMap((r) => w.map((f) => `Edit(/${r}/*/${f})`))] } : { allow: read, deny: roots.map((r) => `Edit(/${r}/**)`) } };
};

// Writes the role, project index and settings on every open, so edits reach the next conversation; memory.md is the agent's own.
export async function prepareAdvisor(a: Advisor, roots = ROOTS, home = ADVISOR_HOME) {
  const dir = path.join(home, a.id);
  await mkdir(path.join(dir, '.claude'), { recursive: true });
  const role = (await readFile(path.join(ROLES, `${a.id}.md`), 'utf8')).replaceAll('{{kit}}', KIT);
  await writeIfChanged(path.join(dir, 'CLAUDE.md'), `${role.trim()}\n\n${rules}`);
  await writeIfChanged(path.join(dir, 'projects.md'), roots === ROOTS ? await cachedIndex() : await projectIndex(roots));
  await writeIfChanged(path.join(dir, '.claude/settings.json'), `${JSON.stringify(settings(a, roots), null, 2)}\n`);
  if (!existsSync(path.join(dir, 'memory.md'))) await writeFile(path.join(dir, 'memory.md'), `# ${a.name} memory\n`);
  return dir;
}

// The Advisors page: each advisor's memory and its five latest conversations.
export const advisorsInfo = (home = ADVISOR_HOME): Promise<AdvisorInfo[]> =>
  Promise.all(ADVISORS.map(async (a) => {
    const dir = path.join(home, a.id);
    const [memory, list] = await Promise.all([readFile(path.join(dir, 'memory.md'), 'utf8').catch(() => ''), existsSync(dir) ? listSessions({ dir, limit: 5 }) : []]);
    return { id: a.id, memory, chats: list.map(savedSession).map(({ sessionId, title, lastModified }) => ({ sessionId, title, lastModified })) };
  }));

// A project's ranked backlog, each item with whether its spec file exists.
export async function readBacklog(root: string): Promise<BacklogItem[]> {
  const items = parseBacklog(await readFile(path.join(root, '.claude/backlog.md'), 'utf8').catch(() => ''));
  return items.map((i) => ({ ...i, spec: existsSync(path.join(root, '.claude/specs', `${i.slug}.md`)) }));
}

// Moves one backlog line up or down in the project's file, through a temp file so a failed write keeps the old one; false when the slug is not in it.
export async function moveBacklogFile(root: string, slug: string, dir: 'up' | 'down'): Promise<boolean> {
  const file = path.join(root, '.claude/backlog.md');
  const next = moveBacklog(await readFile(file, 'utf8').catch(() => ''), slug, dir);
  if (next === null) return false;
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, next);
  await rename(tmp, file);
  return true;
}

// A project's newest audit with its parsed findings, null when none was written.
export async function readAudit(root: string): Promise<Audit | null> {
  const dir = path.join(root, '.claude/audits');
  const name = (await readdir(dir).catch(() => [] as string[])).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().pop();
  if (!name) return null;
  return { date: name.slice(0, -3), path: path.join(dir, name), findings: parseAudit(await readFile(path.join(dir, name), 'utf8')) };
}
