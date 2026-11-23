import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { IconButton } from '../../ui/Button';
import { voiceEnded } from './voiceLogic';

type Result = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<Result> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export function recognizer() {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const HOLD_MS = 400;
const ERROR_MS = 7000;

// With onSubmit it is the round Talk button: when dictation ends with words heard, onSubmit sends them.
export function Voice({ onText, onSubmit, onListen, autoStart }: { onText: (text: string, final: boolean) => void; onSubmit?: () => void; onListen?: (on: boolean) => void; autoStart?: number }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const rec = useRef<Recognition | null>(null);
  const handlers = useRef({ onText, onSubmit, onListen });
  handlers.current = { onText, onSubmit, onListen };
  const pressed = useRef(0);
  const stopped = useRef(false);

  const begin = useRef<() => void>(undefined);
  useEffect(() => () => { stopped.current = true; rec.current?.stop(); }, []);
  useEffect(() => handlers.current.onListen?.(listening), [listening]);
  useEffect(() => { if (autoStart && !rec.current) begin.current?.(); }, [autoStart]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), ERROR_MS);
    return () => clearTimeout(t);
  }, [error]);

  const SR = recognizer();
  if (!SR) return null;

  const start = () => {
    stopped.current = false;
    const r = new SR();
    r.lang = navigator.language;
    r.continuous = true;
    r.interimResults = true;
    let done = 0;
    let pending = '';
    let heard = '';
    let code: string | null = null;
    let began = 0;
    r.onresult = (e) => {
      const rest = Array.from(e.results).slice(done);
      pending = rest.map((x) => x[0].transcript).join('').trim();
      const final = rest.every((x) => x.isFinal);
      if (final) done = e.results.length;
      handlers.current.onText(pending, final);
      if (final) { heard += pending; pending = ''; }
    };
    r.onerror = (e) => { code = e.error; };
    r.onend = () => {
      if (pending) { handlers.current.onText(pending, true); heard += pending; }
      const spoke = !!heard.trim();
      if (spoke) handlers.current.onSubmit?.();
      const message = voiceEnded({ error: code, heard: spoke, ms: Date.now() - began, mac: /Macintosh/.test(navigator.userAgent), stopped: stopped.current });
      if (message) setError(message);
      rec.current = null;
      setListening(false);
    };
    try {
      r.start();
      began = Date.now();
    } catch {
      setError('Voice input failed to start');
      return;
    }
    setError('');
    rec.current = r;
    setListening(true);
  };
  begin.current = start;
  const stop = () => { stopped.current = true; rec.current?.stop(); };

  return (
    <>
    <IconButton
      className={`voice${onSubmit ? ' cp-talk' : ''}${error ? ' error' : ''}`}
      icon={onSubmit ? (listening ? 'debug-stop' : 'unmute') : listening ? 'mic-filled' : 'mic'}
      label={onSubmit ? 'Talk' : 'Dictate'}
      on={listening}
      title={error || (listening ? 'Stop and send' : onSubmit ? 'Talk (click, or hold to talk)' : 'Dictate (click, or hold to talk)')}
      aria-pressed={listening}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (rec.current) { stop(); pressed.current = 0; return; }
        pressed.current = Date.now();
        start();
      }}
      onPointerUp={() => {
        if (pressed.current && Date.now() - pressed.current > HOLD_MS) stop();
        pressed.current = 0;
      }}
      onClick={(e) => { if (e.detail === 0) (rec.current ? stop : start)(); }}
    />
    {error && <div className="as-snack" role="alert">{error}</div>}
    </>
  );
}

export function useDictation(text: string, setText: Dispatch<SetStateAction<string>>) {
  const live = useRef({ rendered: text, text });
  if (live.current.rendered !== text) live.current = { rendered: text, text };
  const said = useRef<{ base: string; wrote: string } | 'edited' | null>(null);
  return (t: string, final: boolean) => {
    let u = said.current;
    if (u && u !== 'edited' && live.current.text !== u.wrote) u = 'edited';
    if (u === 'edited') {
      said.current = final ? null : u;
      return;
    }
    const b = u?.base ?? live.current.text;
    const value = b && t ? `${b}${/\s$/.test(b) ? '' : ' '}${t}` : b + t;
    said.current = final ? null : { base: b, wrote: value };
    live.current.text = value;
    setText(value);
  };
}
