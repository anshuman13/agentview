import { useEffect, useState } from 'react';
import { IconButton } from '../../ui/Button';
import { Confirm, type ConfirmRequest } from '../../ui/Confirm';
import { Row } from '../../ui/Row';
import { Section } from '../../ui/Section';
import { Sheet } from '../../ui/Sheet';
import { Icon } from '../../ui/Icon';
import { tauriInvoke } from '../runtime/tauri';
import { appSettings } from '../appSettings';
import { saveFeatureUse } from '../featureUseApi';
import { notice } from '../store';
import { hubDebug } from '../runtime/hubDebug';
import { THEME_NAMES, useTheme } from '../theme';
import { FeatureUseSheet } from './FeatureUseSheet';
import { ModelsSettings } from './ModelsSettings';
import { VIEWS } from './ActivityBar';
import { TRANSCRIPT_VIEWS } from '../../chat/transcript/steps';
import { setTranscriptView, transcriptView } from '../../chat/transcript/transcriptView';
import { setTranscriptWidth, TRANSCRIPT_WIDTHS, transcriptWidth } from '../../chat/transcript/transcriptWidth';
import { CODE_FONT_SIZES, codeFontSize, setCodeFontSize } from '../../ui/codeFont';
import { canHideView, hiddenViews, toggleHiddenView } from './hiddenViews';

const webSha = typeof __APP_SHA__ === 'string' ? __APP_SHA__ : '';

const versionText = (sha = webSha) => sha || 'Unknown';

const tauriAppVersion = async () => {
  const invoke = tauriInvoke();
  return invoke ? String(await invoke('plugin:app|version')) : '';
};

export function PrivacyGroup({ on, anyHidden, onToggle, onOpen, onInfo }: { on: boolean; anyHidden: boolean; onToggle: () => void; onOpen: () => void; onInfo: () => void }) {
  return (
    <>
      <Section label="Privacy" action={<IconButton icon="info" label="About feature analytics" size="sm" onClick={onInfo} />} />
      <div className="ui-group">
        <Row title="Feature analytics" meta={on ? 'On' : 'Off'} onClick={onToggle} />
        {(on || anyHidden) && <Row title="Feature use" trailing={<Icon name="chevron-right" small />} onClick={onOpen} />}
      </div>
    </>
  );
}

function PrivacySettings() {
  const on = appSettings.use((s) => s.featureUse);
  const anyHidden = appSettings.use((s) => s.hiddenFeatures.length > 0);
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const [sheet, setSheet] = useState<'use' | 'info' | null>(null);
  const save = (featureUse: boolean) => saveFeatureUse(featureUse).then((r) => appSettings.patch({ featureUse: r.featureUse ?? false }), (err) => notice(err instanceof Error ? err.message : 'Could not save'));
  const toggle = () => on
    ? setAsk({ title: 'Turn off feature analytics?', detail: 'The counts so far are deleted.', action: 'Turn off', run: () => save(false) })
    : void save(true);
  return (
    <>
      <PrivacyGroup on={on} anyHidden={anyHidden} onToggle={toggle} onOpen={() => setSheet('use')} onInfo={() => setSheet('info')} />
      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
      {sheet === 'use' && <FeatureUseSheet onClose={() => setSheet(null)} />}
      {sheet === 'info' && (
        <Sheet label="Feature analytics" onClose={() => setSheet(null)} className="as-dialog">
          <Section label="Feature analytics" />
          <div className="ui-group">
            <Row plain lines={2} title="Counts per feature per day, kept on this Mac for 90 days, never sent anywhere." />
          </div>
        </Sheet>
      )}
    </>
  );
}

function ActivityBarSettings() {
  const hidden = hiddenViews.use();
  return (
    <div className="desktop-only">
      <Section label="Activity bar" />
      <div className="ui-group">
        {VIEWS.filter((v) => canHideView(v.id)).map((v) => <Row key={v.id} title={v.title} meta={hidden.includes(v.id) ? 'Hidden' : 'Shown'} onClick={() => toggleHiddenView(v.id)} />)}
      </div>
    </div>
  );
}

const VIEW_LABEL = { normal: 'Normal', thinking: 'Thinking', verbose: 'Verbose' } as const;

function TranscriptViewSwitch() {
  const view = transcriptView.use();
  return (
    <div className="view-seg" role="radiogroup" aria-label="Transcript view">
      {TRANSCRIPT_VIEWS.map((v) => <button key={v} role="radio" aria-checked={view === v} className={view === v ? 'on' : ''} onClick={() => setTranscriptView(v)}>{VIEW_LABEL[v]}</button>)}
    </div>
  );
}

function TranscriptWidthSwitch() {
  const width = transcriptWidth.use();
  return (
    <div className="view-seg" role="radiogroup" aria-label="Transcript width">
      {TRANSCRIPT_WIDTHS.map((w) => <button key={w} role="radio" aria-checked={width === w} className={width === w ? 'on' : ''} onClick={() => setTranscriptWidth(w)}>{w === 'wide' ? 'Wide' : 'Narrow'}</button>)}
    </div>
  );
}

function CodeFontSizeSwitch() {
  const size = codeFontSize.use();
  return (
    <div className="view-seg" role="radiogroup" aria-label="Code font size">
      {CODE_FONT_SIZES.map((px) => <button key={px} role="radio" aria-checked={size === px} className={size === px ? 'on' : ''} title={px === 13 ? 'Default' : undefined} onClick={() => setCodeFontSize(px)}>{px}</button>)}
    </div>
  );
}

export function SettingsView({ showDesign, phoneVersion }: { showDesign?: boolean; phoneVersion?: string }) {
  const [theme, toggleTheme] = useTheme();
  return (
    <>
      <Section label="About" />
      <div className="ui-group">
        <Row plain title="App version" meta={versionText()} />
        {showDesign && <Row title="Design" meta="Primitives and states, at desktop and phone width" trailing={<Icon name="chevron-right" small />} onClick={() => location.assign('/design')} />}
      </div>
      <Section label="Appearance" />
      <div className="ui-group">
        <Row title="Theme" meta={THEME_NAMES[theme]} onClick={toggleTheme} />
        <Row plain title="Transcript view" trailing={<TranscriptViewSwitch />} />
        <Row plain title="Transcript width" trailing={<TranscriptWidthSwitch />} />
        <Row plain title="Code font size" trailing={<CodeFontSizeSwitch />} />
      </div>
      <ActivityBarSettings />
      <ModelsSettings />
      <PrivacySettings />
      {phoneVersion && (
        <>
          <Section label="Phone" />
          <div className="ui-group">
            <Row plain title="Installed version" meta={phoneVersion} />
          </div>
        </>
      )}
    </>
  );
}

export function Settings({ dev = import.meta.env.DEV, debug = hubDebug, appVersion = tauriAppVersion }: { dev?: boolean; debug?: () => Promise<boolean>; appVersion?: () => Promise<string> }) {
  const [flag, setFlag] = useState<boolean>();
  const [tauriVersion, setTauriVersion] = useState<string>();
  useEffect(() => {
    if (!dev) debug().then(setFlag, () => setFlag(false));
  }, [dev, debug]);
  useEffect(() => {
    appVersion().then(setTauriVersion, () => {});
  }, [appVersion]);
  return <SettingsView showDesign={dev || flag} phoneVersion={tauriVersion} />;
}
