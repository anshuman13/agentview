import type { ReactNode } from 'react';
import { IconButton } from '../../ui/Button';
import { useBack } from '../touch/back';
import { useNarrow } from './useNarrow';
import '../../styles/features/wiki.css';

type Props = { title: ReactNode; sub?: ReactNode; slot?: string; onBack: () => void };

function Header({ title, sub, slot, onBack }: Props) {
  useBack(onBack);
  return (
    <header className="wk-head phone-head">
      <IconButton icon="arrow-left" label="Back" onClick={onBack} />
      <div className="phone-head-text">
        <h1>{title}</h1>
        {sub && <div className="phone-head-sub">{sub}</div>}
      </div>
      {slot && <span id={slot} className="phone-head-action" />}
    </header>
  );
}

// The one header of a phone page or tool: Back, the title, and a slot the screen portals its one action into.
export function PhoneHeader(props: Props) {
  return useNarrow() ? <Header {...props} /> : null;
}
