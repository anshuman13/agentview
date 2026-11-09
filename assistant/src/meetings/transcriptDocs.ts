import fs from 'node:fs';
import path from 'node:path';

const CHUNK = 30_000;

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('') : '';

// A Drive read returns the doc as JSON with fileContent, sometimes inside a list of text blocks.
function docText(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.fileContent === 'string') return parsed.fileContent;
    if (Array.isArray(parsed)) return docText(textOf(parsed));
  } catch {}
  return raw;
}

// Large tool outputs are saved under the config dir's tool-results folders.
function savedText(root: string, file: string) {
  const real = fs.realpathSync(path.resolve(file));
  const projects = fs.realpathSync(path.join(root, 'projects'));
  if (!real.startsWith(projects + path.sep) || !real.split(path.sep).includes('tool-results')) throw new Error('Only saved tool outputs can be read');
  return docText(fs.readFileSync(real, 'utf8'));
}

export function readSaved(root: string, file: string, offset = 0) {
  const text = savedText(root, file);
  const end = Math.min(text.length, offset + CHUNK);
  return `${text.slice(offset, end)}\n[characters ${offset}-${end} of ${text.length}]`;
}

const docIdOf = (s: string) => /\/d\/([\w-]{20,})/.exec(s)?.[1] ?? (/^[\w-]{20,}$/.test(s.trim()) ? s.trim() : null);

type Block = { type?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean };

// The docs read during an import, by doc id, taken from the tool calls and their results in the query stream. An output
// too large to return names the file it was saved to, which is read whole.
export function docReader(root: string) {
  const calls = new Map<string, string>();
  const texts = new Map<string, string>();
  const see = (m: { type: string; message?: unknown }) => {
    const content = m.type === 'assistant' || m.type === 'user' ? (m.message as { content?: unknown } | undefined)?.content : null;
    if (!Array.isArray(content)) return;
    for (const b of content as Block[]) {
      if (b.type === 'tool_use' && b.id && /(read_file_content|read_doc)$/.test(b.name ?? '')) {
        const doc = Object.values(b.input ?? {}).map((v) => (typeof v === 'string' ? docIdOf(v) : null)).find(Boolean);
        if (doc) calls.set(b.id, doc);
      }
      const doc = b.type === 'tool_result' && !b.is_error ? calls.get(b.tool_use_id ?? '') : undefined;
      if (!doc) continue;
      const raw = textOf(b.content);
      const file = /(\/\S*\/tool-results\/[\w.-]*\w)/.exec(raw)?.[1];
      let text: string;
      try {
        text = (file ? savedText(root, file) : docText(raw)).trim();
      } catch {
        continue;
      }
      if (text.length > (texts.get(doc)?.length ?? 0)) texts.set(doc, text);
    }
  };
  // The doc the notes name; when they name none that was read, the only doc read, if it is alone.
  const textFor = (url: string, alone: boolean) => {
    const id = docIdOf(url);
    if (id && texts.has(id)) return { doc: id, text: texts.get(id)! };
    if (!alone || texts.size !== 1) return null;
    const [doc, text] = [...texts][0];
    return { doc, text };
  };
  return { see, textFor };
}
