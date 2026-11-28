import { relPath } from '../chat/transcript/steps';

const resolve = (path: string) => {
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '..') out.pop();
    else if (seg && seg !== '.') out.push(seg);
  }
  return `/${out.join('/')}`;
};

const last = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export function pathCopies(path: string, cwd: string) {
  if (path.startsWith('~/') || (!cwd && !path.startsWith('/'))) return { absolute: path, relative: null, name: last(path) };
  const absolute = resolve(path.startsWith('/') ? path : `${cwd}/${path}`);
  const rel = relPath(absolute, cwd);
  return { absolute, relative: rel === '.' || rel.startsWith('/') ? null : rel, name: last(absolute) };
}

// What Attach as context puts in the composer: the path as an @ mention, relative to the chat's folder when it can be.
export function mentionOf(path: string, cwd: string) {
  const { absolute, relative } = pathCopies(path, cwd);
  return `@${relative ?? absolute}`;
}
