import { useEffect, useState } from 'react';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Icon } from '../ui/Icon';
import { tauriInvoke } from '../codex/data/local';
import { hubDebug } from './hubDebug';
import { THEME_NAMES, useTheme } from './theme';

const webSha = typeof __APP_SHA__ === 'string' ? __APP_SHA__ : '';

export const versionText = (sha = webSha) => sha || 'Unknown';

const tauriAppVersion = async () => {
  const invoke = tauriInvoke();
  return invoke ? String(await invoke('plugin:app|version')) : '';
};

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
      </div>
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
