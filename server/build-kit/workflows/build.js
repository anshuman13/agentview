export const meta = {
  name: 'build',
  description: 'For each feature brief: pm writes a spec, reviewer approves it, designer sketches it, you approve it, implementer builds it in a worktree, tester checks it; loops until pass or out of rounds',
  phases: [
    { title: 'Spec', detail: 'pm writes; spec-reviewer approves (up to 3 rounds); a cold reader, a zoom-out reviewer and an architect read round 1; designer sketches UI specs' },
    { title: 'Build', detail: 'waits for your approval, then implementer in a worktree, tester verifies (up to 3 rounds)' },
  ],
}

const features = Array.isArray(args) ? args : args?.features ?? []
if (!features.length) return { error: 'args must be a list of {slug, brief}' }
const specRounds = args?.specRounds ?? 3
const buildRounds = args?.buildRounds ?? 3
const branchPrefix = args?.branchPrefix ?? 'build/'
const approval = args?.approval !== false
// true, false or 'auto': sketch when the spec's acceptance criteria have a (UI) item.
const sketchArg = args?.sketch ?? 'auto'
// The main checkout, so implementer and tester in a worktree find the sketch, which is not committed.
const root = args?.root
// The kit folder, so the gate agent can run the kit's script from any repo.
const kit = args?.kit
if (approval && !kit) return { error: 'args.kit (the build kit folder) is required while approval is on' }

const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'revise'] },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'issues'],
}

const GATE = {
  type: 'object',
  properties: { decision: { type: 'string', enum: ['approve', 'changes', 'wait', 'error'] }, note: { type: 'string' } },
  required: ['decision', 'note'],
}

const CODE_REVIEW = {
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['clean', 'changes'] }, issues: { type: 'array', items: { type: 'string' } } },
  required: ['verdict', 'issues'],
}

const TEST = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    report: { type: 'string', description: 'per criterion result with evidence' },
    fixes: { type: 'array', items: { type: 'string' }, description: 'what the implementer must change, one per fail' },
  },
  required: ['verdict', 'report', 'fixes'],
}

async function spec(f) {
  const path = `.claude/specs/${f.slug}.md`
  let text = await agent(
    `Feature brief: ${f.brief}\n\nWrite the spec to ${path} and return its full contents.`,
    { label: `pm:${f.slug}`, phase: 'Spec', agentType: 'agentview:pm' })
  let review = null
  let pmRound = 1
  for (let round = 1; round <= specRounds; round++) {
    const ask = `Review round ${round} of ${specRounds}. Feature brief: ${f.brief}\n\nSpec, found at ${path}:\n\n${text}`
    const reviewers = [['review', 'spec-reviewer']]
    if (round === 1) reviewers.push(['reader', 'spec-reader'], ['zoom-out', 'zoom-out'], ['architect', 'architect'])
    const reviews = await parallel(reviewers.map(([tag, agentType]) => () =>
      agent(ask, { label: `${tag}:${f.slug}#${round}`, phase: 'Spec', agentType: `agentview:${agentType}`, schema: REVIEW })
        .then(r => r && { ...r, issues: r.issues.map(i => tag === 'review' ? i : `[${tag}] ${i}`) })))
    const got = reviews.filter(Boolean)
    review = got.length ? { verdict: got.some(r => r.verdict === 'revise') ? 'revise' : 'approve', issues: got.flatMap(r => r.issues) } : null
    if (!review || review.verdict === 'approve') break
    log(`${f.slug}: spec round ${round} revise (${review.issues.length} issues)`)
    text = await agent(
      `Feature brief: ${f.brief}\n\nYour spec at ${path} was reviewed. Fix every issue below, rewrite the file and return its full contents.\n\nIssues:\n- ${review.issues.join('\n- ')}`,
      { label: `pm:${f.slug}#${round + 1}`, phase: 'Spec', agentType: 'agentview:pm' })
    pmRound = round + 1
  }
  const issues = review?.issues ?? []
  if (review && review.verdict !== 'approve') log(`${f.slug}: building with ${issues.length} open reviewer notes`)
  const s = { ...f, path, spec: text, approved: true, notes: issues, pmRound, sketch: null }
  return wantsSketch(text) ? { ...s, sketch: await draw(s, `Sketch the screens this spec changes.\n\nSpec, found at ${path}:\n\n${text}`, 1) } : s
}

function wantsSketch(spec) {
  if (sketchArg !== 'auto') return sketchArg === true
  return (spec.split(/^## +/m).find((p) => /^Acceptance criteria\b/i.test(p)) ?? '').includes('(UI)')
}

// The sketch the user approved, for the implementer and tester; the spec wins where they differ.
const sketchRef = (s) => !s.sketch ? '' : `\n\nThere is a sketch of these screens at ${root ? `${root}/${s.sketch}` : `${s.sketch} in the main checkout`}. Read it and match its layout; where it differs from the spec, the spec wins.`

// The designer writes .claude/sketches/<slug>.html; the path, or null when it failed (the build goes on without a sketch).
async function draw(s, ask, round) {
  const file = `.claude/sketches/${s.slug}.html`
  const r = await agent(`${ask}\n\nWrite the sketch to ${file}.`, { label: `sketch:${s.slug}#${round}`, phase: 'Spec', agentType: 'agentview:designer' })
  if (!r) log(`${s.slug}: sketch round ${round} failed`)
  return r ? file : s.sketch
}

async function gate(s) {
  let text = s.spec
  let round = s.pmRound
  let sketchRound = 1
  for (;;) {
    const g = await agent(
      `Wait for the user's decision on the spec with slug ${s.slug}. Command: bun ${kit}/workflows/approval-gate.ts ${s.slug}`,
      { label: `gate:${s.slug}`, phase: 'Build', agentType: 'agentview:approval-gate', schema: GATE })
    if (!g || g.decision === 'error') return null
    if (g.decision === 'approve') return text
    if (g.decision === 'changes') {
      log(`${s.slug}: user asked for changes`)
      // One block per phase; the Sketch block goes to the designer, the rest to the pm.
      const blocks = g.note.split(/\n(?=(?:Requirements|Design|Tasks|Sketch): )/)
      const sketchNote = blocks.filter((b) => b.startsWith('Sketch: ')).join('\n')
      const specNote = blocks.filter((b) => !b.startsWith('Sketch: ')).join('\n')
      if (specNote) text = await agent(
        `Feature brief: ${s.brief}\n\nThe user asked for changes to your spec at ${s.path}. Apply them, rewrite the file and return its full contents.\n\nUser note:\n${specNote}`,
        { label: `pm:${s.slug}#${++round}`, phase: 'Spec', agentType: 'agentview:pm' })
      if (sketchNote || (s.sketch && specNote)) s.sketch = await draw(s, [
        `Update your sketch at .claude/sketches/${s.slug}.html.`,
        sketchNote && `The user's note on the sketch:\n${sketchNote}`,
        specNote && `The spec changed (notes: ${specNote}); update the sketch where it is affected.`,
        `Spec, found at ${s.path}:\n\n${text}`,
      ].filter(Boolean).join('\n\n'), ++sketchRound)
    }
  }
}

async function build(s) {
  if (approval) {
    const text = await gate(s)
    if (text === null) {
      log(`${s.slug}: approval gate failed`)
      return { ...s, gateFailed: true }
    }
    s = { ...s, spec: text }
  }
  const notes = (s.notes.length ? `\n\nReviewer notes (apply where they make the spec clearer):\n- ${s.notes.join('\n- ')}` : '') + sketchRef(s)
  let impl = await agent(
    `Implement this spec. Branch name: ${branchPrefix}${s.slug}.\n\n${s.spec}${notes}`,
    { label: `impl:${s.slug}`, phase: 'Build', agentType: 'agentview:implementer', isolation: 'worktree' })
  let test = null
  for (let round = 1; round <= buildRounds; round++) {
    test = await agent(
      `Spec:\n${s.spec}${sketchRef(s)}\n\nImplementer result:\n${impl}`,
      { label: `test:${s.slug}#${round}`, phase: 'Build', agentType: 'agentview:tester', schema: TEST })
    if (!test || test.verdict === 'pass') break
    log(`${s.slug}: build round ${round} fail (${test.fixes.length} fixes)`)
    impl = await agent(
      `Your implementation of this spec failed testing. Work in the same worktree and branch as before (see your earlier result), apply the fixes, rerun the checks, amend the commit and return the updated result.\n\nSpec:\n${s.spec}\n\nYour earlier result:\n${impl}\n\nTester report:\n${test.report}\n\nFixes required:\n- ${test.fixes.join('\n- ')}`,
      { label: `impl:${s.slug}#${round + 1}`, phase: 'Build', agentType: 'agentview:implementer' })
  }
  if (test?.verdict === 'pass') {
    const rev = await agent(
      `Review the commit from this implementation. Spec:\n${s.spec}\n\nImplementer result:\n${impl}`,
      { label: `code-review:${s.slug}`, phase: 'Build', agentType: 'agentview:code-reviewer', schema: CODE_REVIEW })
    if (rev && rev.verdict !== 'clean' && rev.issues.length) {
      impl = await agent(
        `Apply these code review issues in the same worktree and branch as before (see your earlier result), rerun the checks, amend the commit and return the updated result.\n\nSpec:\n${s.spec}\n\nYour earlier result:\n${impl}\n\nIssues:\n- ${rev.issues.join('\n- ')}`,
        { label: `impl:${s.slug}#review`, phase: 'Build', agentType: 'agentview:implementer' })
      test = await agent(
        `Spec:\n${s.spec}${sketchRef(s)}\n\nImplementer result:\n${impl}`,
        { label: `test:${s.slug}#review`, phase: 'Build', agentType: 'agentview:tester', schema: TEST })
    }
  }
  return { ...s, built: true, impl, test }
}

const results = await pipeline(features, spec, build)
return results.filter(Boolean).map(r => ({
  slug: r.slug, path: r.path, notes: r.notes,
  passed: r.test?.verdict === 'pass', impl: r.impl, report: r.gateFailed ? 'approval gate failed' : r.test?.report, fixes: r.test?.fixes,
}))
