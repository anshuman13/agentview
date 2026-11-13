import type { ReactNode } from 'react';
import { Icon } from '../../ui/Icon';
import { TranscriptBox } from './Box';
import { workTitle, type Work } from './workFold';

export function WorkBox({ id, work, live, billing, children }: { id: string; work: Work; live: boolean; billing: string; children: ReactNode }) {
  const { text, failed } = workTitle(work, live, billing);
  const title = <>{text}{failed && <>{text && ' · '}<span className="tr-work-bad">{failed}</span></>}</>;
  return (
    <TranscriptBox id={`work:${id}`} title={title} state={live ? <Icon name="loading" small spin /> : undefined}>
      <div className="tr-work">{children}</div>
    </TranscriptBox>
  );
}
