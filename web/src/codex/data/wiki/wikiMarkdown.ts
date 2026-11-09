import { pageClaims, sourcesOf } from './wiki';

type Groups = ReturnType<typeof pageClaims>;

export function wikiMarkdown(title: string | null, groups: Groups) {
  const out = [`# ${title || 'Untitled'}`];
  for (const g of groups) {
    const live = g.claims.filter((c) => c.fact.state !== 'proposed');
    if (!live.length) continue;
    const lines = live.map(({ fact }) => {
      const labels = [...new Set(sourcesOf(fact).map((s) => s.label))];
      return `- ${fact.text ?? ''}` + (labels.length ? `\n  Sources: ${labels.join(', ')}` : '');
    });
    out.push(`## ${g.heading}\n\n${lines.join('\n')}`);
  }
  return out.join('\n\n') + '\n';
}

export const hasLiveClaims = (groups: Groups) => groups.some((g) => g.claims.some((c) => c.fact.state !== 'proposed'));
