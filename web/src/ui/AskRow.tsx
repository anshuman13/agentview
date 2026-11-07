import type { ComponentProps, ReactNode } from 'react';
import { Row } from './Row';

export function AskRow({ actions, children, ...row }: Omit<ComponentProps<typeof Row>, 'action' | 'href' | 'plain' | 'className'> & { actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ov-ask">
      <div className="ui-row-wrap">
        <Row {...row} />
        {actions && <span className="ov-ask-actions">{actions}</span>}
      </div>
      {children}
    </div>
  );
}
