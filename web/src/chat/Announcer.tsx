import { useEffect, useRef, useState } from 'react';
import { getState, useStore } from '../app/store';
import { turnEnd } from './composer/composerLogic';

// Tells a screen reader when Claude's turn ends or Claude asks something, without reading every streamed word.
export function Announcer() {
  const running = useStore((s) => s.session.running);
  const ask = useStore((s) => s.pending[s.pending.length - 1]);
  const [text, setText] = useState('');
  const was = useRef(running);
  useEffect(() => {
    if (was.current && !running) setText(turnEnd(getState().events));
    was.current = running;
  }, [running]);
  useEffect(() => {
    if (ask) setText(ask.kind === 'question' ? `Claude asks: ${ask.questions[0]?.question ?? ''}` : `Claude asks for permission: ${ask.title}`);
  }, [ask?.id]);
  return <div className="sr-only" role="status">{text}</div>;
}
