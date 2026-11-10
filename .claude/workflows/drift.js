export const meta = {
  name: 'drift',
  description: 'One fresh agent per doc under docs/ compares it with the code and returns only the claims that drifted',
  phases: [{ title: 'Check', detail: 'drift-checker per doc' }],
}

const docs = Array.isArray(args) && args.length ? args : [
  'docs/architecture.md', 'docs/features.md', 'docs/design-system.md', 'docs/assistant.md', 'docs/macs.md',
  'docs/autopilot.md', 'docs/codex-flows.md', 'docs/codex-wiki.md', 'docs/integrations.md',
]

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: { doc: { type: 'string' }, claim: { type: 'string' }, code: { type: 'string' }, fix: { type: 'string', enum: ['doc', 'code'] } },
        required: ['doc', 'claim', 'code', 'fix'],
      },
    },
  },
  required: ['findings'],
}

const results = await parallel(docs.map(doc => () =>
  agent(`Check ${doc} against the code in this repo.`, { label: `drift:${doc}`, phase: 'Check', agentType: 'drift-checker', schema: FINDINGS })))
return docs.map((doc, i) => ({ doc, findings: results[i]?.findings ?? null }))
