import { keyWords, overlap, SIMILAR } from './claimMatch.js';
import { proposalSource } from './proposalSource.js';

export const TICKET_OR_PR = /\b(?!(?:UTF|SHA|ISO|AES|RSA|GPT)-)[A-Z]{2}[A-Z0-9]*-\d+\b|(?<![\w&#])#\d{1,6}\b(?![0-9a-fA-F])|github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/;

const NARROW = [
  TICKET_OR_PR,
  /https?:\/\//,
  /\b(?!(?:package|tsconfig|pyproject|Cargo)\.|[A-Z_]+\.md\b)[\w-]+\.(?:tsx?|jsx|json|md|py|kt|swift|go|rs|sh|ya?ml|toml|css|html|sql|txt|pdf|pptx?|docx?|xlsx?|csv|png|jpe?g|svg)\b/,
  /(?:^|[\s(`'"])(?:~|\.{1,2})?\/[\w.-]+/,
  /\bthis (?:deck|slide|PR|pull request|branch|commit|chat|task|ticket|chapter)\b/i,
  /\bas (?:he|she|they|I) asked (?:when|for)\b/i,
];

const MOSTLY_MIN = 5;
const MOSTLY_SHARE = 0.85;
const NEAR = 0.4;
const NEAREST = 5;
const NO_MOSTLY = new Set(['chat', 'agent', 'corrections']);

// Key words without a leading "As of <date>," or four-digit years, so dated claims do not match on the date.
const gateWords = (t: string) => new Set([...keyWords(t.replace(/^as of [^,]*,\s*/i, ''))].filter((w) => !/^\d{4}$/.test(w)));

export type SkipReason = 'Like a rejected claim' | 'Source mostly rejected' | 'Too narrow' | 'Like rejected claims';
export type Decided = { text: string; words: Set<string>; source: string | null; rejected: boolean; reason: string | null; at: number };
export type FactRow ={ id: string; text: string | null; added_by: string | null; state: string | null; updated_at: number; decided_at?: number | null; reject_reason?: string | null };

// Every rejected claim and every live claim that came from a proposal, newest decision first.
export function decisionHistory(rows: FactRow[]): Decided[] {
  return rows
    .filter((f) => f.text && (f.state === 'rejected' || ((f.state ?? 'live') === 'live' && proposalSource(f))))
    .map((f) => ({ text: f.text!, words: gateWords(f.text!), source: proposalSource(f)?.key ?? null, rejected: f.state === 'rejected', reason: f.reject_reason ?? null, at: f.decided_at ?? f.updated_at }))
    .sort((a, b) => b.at - a.at);
}

// Why a proposal from this source should not be made, or null when it may be.
export function gateProposal(text: string, source: string, onPage: boolean, history: Decided[]): SkipReason | null {
  const words = gateWords(text);
  const scored = history.map((h) => ({ h, score: overlap(words, h.words) })).sort((a, b) => b.score - a.score || Number(a.h.rejected) - Number(b.h.rejected));
  if (scored[0]?.h.rejected && scored[0].score >= SIMILAR) return 'Like a rejected claim';
  const own = history.filter((h) => h.source === source);
  if (!NO_MOSTLY.has(source) && own.length >= MOSTLY_MIN && own.filter((h) => h.rejected).length >= MOSTLY_SHARE * own.length) return 'Source mostly rejected';
  if ((source === 'chat' || source === 'agent') && !onPage && NARROW.some((r) => r.test(text))) return 'Too narrow';
  const near = scored.filter((s) => s.score >= NEAR).slice(0, NEAREST);
  const rejected = near.filter((s) => s.h.rejected).length;
  if (near.length >= 3 && rejected >= 2 * (near.length - rejected)) return 'Like rejected claims';
  return null;
}

// The prompt lines with the newest 15 approved and 20 rejected claims of the source, a rejection's reason in brackets.
export function examplesFor(history: Decided[], source: string) {
  const own = history.filter((h) => h.source === source);
  const list = (xs: string[]) => (xs.length ? xs.map((t) => `- ${t}`) : ['(none)']);
  return [
    'Approved before, propose claims like these:',
    ...list(own.filter((h) => !h.rejected).slice(0, 15).map((h) => h.text)),
    '',
    'Rejected before, do not propose claims like these:',
    ...list(own.filter((h) => h.rejected).slice(0, 20).map((h) => (h.reason ? `${h.text} [${h.reason}]` : h.text))),
  ];
}

export type ProposalRun = ReturnType<typeof proposalRun>;

// Gates the proposals of one run from one source and logs what it skipped in one line.
export function proposalRun(history: Decided[], source: string) {
  const skipped = new Map<string, number>();
  return {
    skip(text: string, onPage: boolean) {
      const reason = gateProposal(text, source, onPage, history);
      if (reason) skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
      return reason != null;
    },
    log() {
      const n = [...skipped.values()].reduce((a, b) => a + b, 0);
      if (n) console.log(`${source}: skipped ${n} proposals (${[...skipped].map(([r, k]) => `${r}: ${k}`).join(', ')})`);
    },
  };
}
