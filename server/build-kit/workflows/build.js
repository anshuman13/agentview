export const meta = {
  name: 'build',
  description: 'For each feature brief: pm writes a spec, reviewer approves it, implementer builds it in a worktree, tester checks it; loops until pass or out of rounds',
  phases: [
    { title: 'Spec', detail: 'pm writes; spec-reviewer approves (up to 3 rounds); a cold reader and a zoom-out reviewer read round 1' },
    { title: 'Build', detail: 'implementer in a worktree, tester verifies (up to 3 rounds)' },
  ],
}

const features = Array.isArray(args) ? args : args?.features ?? []
if (!features.length) return { error: 'args must be a list of {slug, brief}' }
const specRounds = args?.specRounds ?? 3
const buildRounds = args?.buildRounds ?? 3
const branchPrefix = args?.branchPrefix ?? 'build/'

const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'revise'] },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'issues'],
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
  for (let round = 1; round <= specRounds; round++) {
    const ask = `Review round ${round} of ${specRounds}. Feature brief: ${f.brief}\n\nSpec, found at ${path}:\n\n${text}`
    const reviewers = [['review', 'spec-reviewer']]
    if (round === 1) reviewers.push(['reader', 'spec-reader'], ['zoom-out', 'zoom-out'])
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
  }
  const issues = review?.issues ?? []
  if (review && review.verdict !== 'approve') log(`${f.slug}: building with ${issues.length} open reviewer notes`)
  return { ...f, path, spec: text, approved: true, notes: issues }
}

async function build(s) {
  const notes = s.notes.length ? `\n\nReviewer notes (apply where they make the spec clearer):\n- ${s.notes.join('\n- ')}` : ''
  let impl = await agent(
    `Implement this spec. Branch name: ${branchPrefix}${s.slug}.\n\n${s.spec}${notes}`,
    { label: `impl:${s.slug}`, phase: 'Build', agentType: 'agentview:implementer', isolation: 'worktree' })
  let test = null
  for (let round = 1; round <= buildRounds; round++) {
    test = await agent(
      `Spec:\n${s.spec}\n\nImplementer result:\n${impl}`,
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
        `Spec:\n${s.spec}\n\nImplementer result:\n${impl}`,
        { label: `test:${s.slug}#review`, phase: 'Build', agentType: 'agentview:tester', schema: TEST })
    }
  }
  return { ...s, built: true, impl, test }
}

const results = await pipeline(features, spec, build)
return results.filter(Boolean).map(r => ({
  slug: r.slug, path: r.path, notes: r.notes,
  passed: r.test?.verdict === 'pass', impl: r.impl, report: r.test?.report, fixes: r.test?.fixes,
}))
