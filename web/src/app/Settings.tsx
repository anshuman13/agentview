import { useEffect, useState } from 'react';
import { EmptyState } from '../ui/Panel';
import { Row } from '../ui/Row';
import { Section } from '../ui/Section';
import { Icon } from '../ui/Icon';
import { hubDebug } from './hubDebug';
import { Loading } from './lazy';

export function SettingsView({ showDesign }: { showDesign: boolean | undefined }) {
  if (showDesign === undefined) return <Loading />;
  if (!showDesign) return <EmptyState size="md" title="Nothing to set up yet" />;
  return (
    <>
      <Section label="About" />
      <div className="ui-group">
        <Row title="Design" meta="Primitives and states, at desktop and phone width" trailing={<Icon name="chevron-right" small />} onClick={() => location.assign('/design')} />
      </div>
    </>
  );
}

export function Settings({ dev = import.meta.env.DEV, debug = hubDebug }: { dev?: boolean; debug?: () => Promise<boolean> }) {
  const [flag, setFlag] = useState<boolean>();
  useEffect(() => {
    if (!dev) debug().then(setFlag, () => setFlag(false));
  }, [dev, debug]);
  return <SettingsView showDesign={dev || flag} />;
}
