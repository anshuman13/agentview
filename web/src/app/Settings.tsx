import { useEffect, useState } from 'react';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Icon } from '../ui/Icon';
import { tauriInvoke } from '../codex/data/local';
import { hubDebug } from './hubDebug';

const webSha = typeof __APP_SHA__ === 'string' ? __APP_SHA__ : '';

export const versionText = (tauriVersion?: string, sha = webSha) => tauriVersion || sha || 'Unknown';

const tauriAppVersion = async () => {
  const invoke = tauriInvoke();
  return invoke ? String(await invoke('plugin:app|version')) : '';
};

export function SettingsView({ showDesign, version }: { showDesign?: boolean; version: string }) {
  return (
    <>
      <Section label="About" />
      <div className="ui-group">
        <Row plain title="App version" meta={version} />
        {showDesign && <Row title="Design" meta="Primitives and states, at desktop and phone width" trailing={<Icon name="chevron-right" small />} onClick={() => location.assign('/design')} />}
      </div>
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
  return <SettingsView showDesign={dev || flag} version={versionText(tauriVersion)} />;
}
