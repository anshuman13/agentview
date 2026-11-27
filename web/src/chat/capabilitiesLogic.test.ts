import { describe, expect, it } from 'bun:test';
import { effortChoices } from './capabilitiesLogic';

describe('effortChoices', () => {
  it('tags the model default and keeps the listed levels', () => {
    const models = [{ value: 'a', displayName: 'A', efforts: ['low', 'medium', 'minimal'], defaultEffort: 'medium' }, { value: 'b', displayName: 'B' }];
    expect(effortChoices(models, 'a')).toEqual([{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium', detail: 'Recommended' }]);
    expect(effortChoices(models, 'b').every((c) => !('detail' in c))).toBe(true);
  });
});
