import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

const root = __dirname

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? cssFiles(path) : path.endsWith('.css') ? [path] : []
  })
}

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const ownBody = (body: string) => body.replace(/\{[^{}]*\}/g, '')

type Block = { prelude: string; body: string; ancestors: string[] }

function blocks(css: string): Block[] {
  const out: Block[] = []
  const stack: { prelude: string; start: number }[] = []
  let last = 0
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      stack.push({ prelude: css.slice(last, i).trim(), start: i + 1 })
      last = i + 1
    } else if (css[i] === '}') {
      const open = stack.pop()
      if (open) out.push({ prelude: open.prelude, body: css.slice(open.start, i), ancestors: stack.map(b => b.prelude) })
      last = i + 1
    } else if (css[i] === ';') last = i + 1
  }
  return out
}

const files = cssFiles(root).map(path => ({ name: path.slice(root.length + 1), css: strip(readFileSync(path, 'utf8')) }))
const reduce = /prefers-reduced-motion:\s*reduce/
const noPref = /prefers-reduced-motion:\s*no-preference/
const inside = (b: Block, re: RegExp) => re.test(b.prelude) || b.ancestors.some(a => re.test(a))

describe('motion', () => {
  it('base.css overrides animation and transition under reduce', () => {
    const base = files.find(f => f.name === 'base.css')
    const ok = blocks(base?.css ?? '').some(b => {
      if (!b.ancestors.some(a => reduce.test(a))) return false
      const sel = b.prelude.split(',').map(s => s.trim())
      return ['*', '*::before', '*::after'].every(s => sel.includes(s))
        && /animation:\s*none\s*!important/.test(b.body)
        && /transition:\s*none\s*!important/.test(b.body)
    })
    expect(ok, 'base.css: missing reduce block with animation and transition none !important on *, *::before, *::after').toBe(true)
  })

  it('smooth scrolling sits inside no-preference', () => {
    for (const f of files) {
      const bad = blocks(f.css).some(b => /scroll-behavior:\s*smooth/.test(ownBody(b.body)) && !inside(b, noPref))
      expect(bad, `${f.name}: scroll-behavior: smooth outside prefers-reduced-motion: no-preference`).toBe(false)
    }
  })

  it('reduce blocks never re-enable motion', () => {
    for (const f of files) {
      const bad = blocks(f.css).some(b => {
        if (!inside(b, reduce)) return false
        const decls = ownBody(b.body).matchAll(/(?:^|[;\s])(?:animation|transition)(?:-[a-z-]+)?\s*:\s*([^;}]+)/g)
        return [...decls].some(m => m[1].replace('!important', '').trim() !== 'none')
      })
      expect(bad, `${f.name}: reduce block sets animation or transition to a value other than none`).toBe(false)
    }
  })
})
