export const meta = {
  name: 'build',
  description: 'For each feature brief: pm writes a spec, reviewer approves it, implementer builds it in a worktree, tester checks it; loops until pass or out of rounds',
  phases: [
    { title: 'Spec', detail: 'pm writes, spec-reviewer approves (up to 3 rounds)' },
    { title: 'Build', detail: 'implementer in a worktree, tester verifies (up to 3 rounds)' },
  ],
}

const features = Array.isArray(args) ? args : args?.features ?? []
if (!features.length) return { error: 'args must be a list of {slug, brief}' }
const specRounds = args?.specRounds ?? 3
const buildRounds = args?.buildRounds ?? 3

const REVIEW = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['approve', 'revise'] },
    issues: { type: 'array', items: { type: 'string' } },
  },
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
    { label: `pm:${f.slug}`, phase: 'Spec', agentType: 'pm' })
  let review = null
  for (let round = 1; round <= specRounds; round++) {
    review = await agent(
      `Review this spec for AgentView, found at ${path}:\n\n${text}`,
      { label: `review:${f.slug}#${round}`, phase: 'Spec', agentType: 'spec-reviewer', schema: REVIEW })
    if (!review || review.verdict === 'approve') break
    log(`${f.slug}: spec round ${round} revise (${review.issues.length} issues)`)
    text = await agent(
      `Feature brief: ${f.brief}\n\nYour spec at ${path} was reviewed. Fix every issue below, rewrite the file and return its full contents.\n\nIssues:\n- ${review.issues.join('\n- ')}`,
      { label: `pm:${f.slug}#${round + 1}`, phase: 'Spec', agentType: 'pm' })
  }
  return { ...f, path, spec: text, approved: review?.verdict === 'approve', issues: review?.issues ?? [] }
}

async function build(s) {
  if (!s.approved) return { ...s, built: false, reason: `spec not approved: ${s.issues.join('; ')}` }
  let impl = await agent(
    `Implement this spec. Branch name: anshuman/build/${s.slug}.\n\n${s.spec}`,
    { label: `impl:${s.slug}`, phase: 'Build', agentType: 'implementer', isolation: 'worktree' })
  let test = null
  for (let round = 1; round <= buildRounds; round++) {
    test = await agent(
      `Spec:\n${s.spec}\n\nImplementer result:\n${impl}`,
      { label: `test:${s.slug}#${round}`, phase: 'Build', agentType: 'tester', schema: TEST })
    if (!test || test.verdict === 'pass') break
    log(`${s.slug}: build round ${round} fail (${test.fixes.length} fixes)`)
    impl = await agent(
      `Your implementation of this spec failed testing. Work in the same worktree and branch as before (see your earlier result), apply the fixes, rerun the checks, amend the commit and return the updated result.\n\nSpec:\n${s.spec}\n\nYour earlier result:\n${impl}\n\nTester report:\n${test.report}\n\nFixes required:\n- ${test.fixes.join('\n- ')}`,
      { label: `impl:${s.slug}#${round + 1}`, phase: 'Build', agentType: 'implementer' })
  }
  return { ...s, built: true, impl, test }
}

const results = await pipeline(features, spec, build)
return results.filter(Boolean).map(r => ({
  slug: r.slug, path: r.path, approved: r.approved, built: r.built,
  passed: r.test?.verdict === 'pass', impl: r.impl, report: r.test?.report, reason: r.reason,
}))
