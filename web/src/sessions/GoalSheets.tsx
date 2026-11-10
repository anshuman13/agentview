import { setUi, useStore } from '../app/store';
import { GoalDetail } from './GoalDetail';
import { GoalSheet } from './GoalSheet';

export function GoalSheets() {
  const sheet = useStore((s) => s.ui.goalSheet);
  if (!sheet) return null;
  const close = () => setUi({ goalSheet: null });
  return sheet.mode === 'start' ? <GoalSheet plan={sheet.plan} here={sheet.here} onClose={close} /> : <GoalDetail id={sheet.run} onClose={close} />;
}
