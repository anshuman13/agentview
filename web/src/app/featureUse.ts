import { FEATURE_IDS } from '../../../shared/featureUse';
import { appSettings } from './appSettings';
import { postFeatureUse } from './featureUseApi';

// One fire-and-forget POST per user action; nothing is sent while the setting is off, and a failure is dropped.
export function track(id: string) {
  if (!appSettings.get().featureUse || !FEATURE_IDS.has(id)) return;
  postFeatureUse(id).then((r) => { if (!r.recorded) appSettings.patch({ featureUse: false }); }, () => {});
}
