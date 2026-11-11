import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'bun:test'

const dir = join(__dirname, 'components')
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const rules = readdirSync(dir)
  .filter(name => name.endsWith('.css'))
  .flatMap(name => [...strip(readFileSync(join(dir, name), 'utf8')).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ file: name, selector: m[1].trim(), body: m[2] })))

const outlines = rules.flatMap(rule => [...rule.body.matchAll(/(?:^|[;\s])outline\s*:\s*([^;]+)/g)].map(m => ({ ...rule, value: m[1].trim() })))
const removed = (value: string) => value === 'none' || value === '0'

describe('focus ring', () => {
  it('finds outline declarations to check', () => {
    expect(outlines.length).toBeGreaterThan(0)
  })

  it('uses the token, never a literal colour or width (none and 0 are allowed)', () => {
    const bad = outlines.filter(o => !removed(o.value) && o.value !== 'var(--focus-ring)')
    expect(bad.map(o => `${o.file}: ${o.selector} { outline: ${o.value} }`)).toEqual([])
  })

  it('never draws the ring on bare :focus', () => {
    const bad = outlines.filter(o => !removed(o.value) && o.selector.split(',').some(s => /:focus(?![-\w])/.test(s)))
    expect(bad.map(o => `${o.file}: ${o.selector}`)).toEqual([])
  })
})
