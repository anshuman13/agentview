import type { ReactNode } from 'react';
import { useNarrow } from '../../app/shell/useNarrow';
import { Icon } from '../../ui/Icon';
import { TranscriptBox } from './Box';
import { workTitle, type Work } from './workFold';

export function WorkBox({ id, work, live, billing, children }: { id: string; work: Work; live: boolean; billing: string; children: ReactNode }) {
  const { text, failed, detail } = workTitle(work, live, billing, useNarrow());
  const title = <>{failed && <><span className="tr-work-bad">{failed}</span>{text && ' · '}</>}{text}</>;
  return (
    <TranscriptBox id={`work:${id}`} className="tr-work-box" title={title} state={live ? <Icon name="loading" small spin /> : undefined}>
      <div className="tr-work">{detail && <div className="tr-work-detail">{detail}</div>}{children}</div>
    </TranscriptBox>
  );
}
