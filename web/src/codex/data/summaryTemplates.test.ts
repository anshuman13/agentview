import { describe, expect, it } from 'vitest';
import { SUMMARY_TEMPLATES, summaryInstructions, type SummaryTemplate } from './summaryTemplates';

describe('summary templates', () => {
  const keys = Object.keys(SUMMARY_TEMPLATES) as SummaryTemplate[];

  it('has the default, 1:1, standup, interview and planning', () => {
    expect(keys).toEqual(['default', 'one_on_one', 'standup', 'interview', 'planning']);
  });

  it('produces a distinct prompt for each template', () => {
    const prompts = keys.map(summaryInstructions);
    expect(new Set(prompts).size).toBe(keys.length);
  });

  it('keeps the default empty and the others non-empty', () => {
    expect(summaryInstructions('default')).toBe('');
    for (const k of keys.filter((k) => k !== 'default')) expect(summaryInstructions(k).length).toBeGreaterThan(20);
  });
});
