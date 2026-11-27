// An element picked in the browser pane: its chip label and the prompt text it adds. Android: workspace/TermLogic.kt.
export type PickedElement = { url: string; tag: string; selector: string; text: string; html: string; shot?: string };

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export const elementChip = (el: PickedElement) => `<${el.tag} /> ${cut(el.text, 40)}`.trim();

export function elementPrompt(el: PickedElement) {
  const lines = [`Element on ${el.url}`, `Selector: \`${el.selector}\``, `Tag: <${el.tag}>`];
  if (el.text) lines.push(`Text: ${cut(el.text, 200)}`);
  return `${lines.join('\n')}\nHTML:\n\`\`\`html\n${cut(el.html, 1000)}\n\`\`\``;
}

// The prompt as sent: the typed text, then one block per picked element.
export const withElements = (text: string, els: PickedElement[]) => [text.trim(), ...els.map(elementPrompt)].filter(Boolean).join('\n\n');
