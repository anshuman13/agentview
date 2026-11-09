import { useEffect, useRef, useState } from 'react';
import { getState, useStore } from '../app/store';
import { providerLabel } from '../../../shared/providers';
import { turnEnd } from './composer/composerLogic';

// Tells a screen reader when the agent's turn ends or it asks something, without reading every streamed word.
export function Announcer() {
  const running = useStore((s) => s.session.running);
  const label = useStore((s) => providerLabel(s.session.provider));
  const ask = useStore((s) => s.pending[s.pending.length - 1]);
  const [text, setText] = useState('');
  const was = useRef(running);
  useEffect(() => {
    if (was.current && !running) setText(turnEnd(getState().events, label));
    was.current = running;
  }, [running]);
  useEffect(() => {
    if (ask) setText(ask.kind === 'question' ? `${label} asks: ${ask.questions[0]?.question ?? ''}` : `${label} asks for permission: ${ask.title}`);
  }, [ask?.id]);
  return <div className="sr-only" role="status">{text}</div>;
}
