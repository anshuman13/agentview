import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useStore } from '../store';
import { Icon } from '../Icon';

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

function recognizer() {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone blocked. Allow it in the site settings',
  'service-not-allowed': 'Speech recognition is not allowed here',
  'no-speech': 'No speech heard',
  network: 'Speech service unreachable',
  'audio-capture': 'No microphone found',
};

const HOLD_MS = 400;

export function Voice({ onText, onSubmit }: { onText: (text: string, final: boolean) => void; onSubmit?: () => void }) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const rec = useRef<Recognition | null>(null);
  const handlers = useRef({ onText, onSubmit });
  handlers.current = { onText, onSubmit };
  const pressed = useRef(0);

  useEffect(() => () => rec.current?.stop(), []);

  const SR = recognizer();
  if (!SR) return null;

  const start = () => {
    const r = new SR();
    r.lang = navigator.language;
    r.continuous = true;
    r.interimResults = true;
    let done = 0;
    let pending = '';
    r.onresult = (e) => {
      const rest = Array.from(e.results).slice(done);
      pending = rest.map((x) => x[0].transcript).join('').trim();
      const final = rest.every((x) => x.isFinal);
      if (final) done = e.results.length;
      handlers.current.onText(pending, final);
      if (final) pending = '';
    };
    r.onerror = (e) => { if (e.error !== 'aborted') setError(ERRORS[e.error] ?? `Voice input failed: ${e.error}`); };
    r.onend = () => {
      if (pending) handlers.current.onText(pending, true);
      rec.current = null;
      setListening(false);
    };
    setError('');
    rec.current = r;
    r.start();
    setListening(true);
  };
  const stop = () => rec.current?.stop();

  return (
    <button
      className={`icon-btn voice${listening ? ' on' : ''}${error ? ' error' : ''}`}
      title={error || (listening ? 'Stop dictation' : 'Dictate (click, or hold to talk)')}
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
    >
      <Icon name={listening ? 'mic-filled' : 'mic'} />
    </button>
  );
}

export function useDictation(text: string, setText: Dispatch<SetStateAction<string>>) {
  const base = useRef<string | null>(null);
  return (t: string, final: boolean) => {
    if (base.current === null || !text.startsWith(base.current)) base.current = text;
    const b = base.current;
    setText(b && t ? `${b}${/\s$/.test(b) ? '' : ' '}${t}` : b + t);
    if (final) base.current = null;
  };
}

function speakable(md: string) {
  return md.replace(/```[\s\S]*?```/g, ' code block. ').replace(/`([^`]*)`/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_#>|~]/g, '');
}

export function ReadAloud() {
  const events = useStore((s) => s.events);
  const [on, setOn] = useState(() => { try { return localStorage.getItem('readAloud') === '1'; } catch { return false; } });
  const since = useRef(Date.now());
  const spoken = useRef(new Set<string>());

  useEffect(() => {
    if (!on) return;
    for (const e of events) {
      if (e.kind !== 'assistant' || e.streaming || !e.text.trim() || e.at < since.current || spoken.current.has(e.id)) continue;
      spoken.current.add(e.id);
      const u = new SpeechSynthesisUtterance(speakable(e.text));
      u.lang = navigator.language;
      speechSynthesis.speak(u);
    }
  }, [events, on]);

  if (!('speechSynthesis' in window)) return null;

  const toggle = () => {
    const next = !on;
    if (next) since.current = Date.now();
    else speechSynthesis.cancel();
    setOn(next);
    try { localStorage.setItem('readAloud', next ? '1' : '0'); } catch { return; }
  };

  return (
    <button className={`icon-btn read-aloud${on ? ' on' : ''}`} title={on ? 'Stop reading replies aloud' : 'Read replies aloud'} aria-pressed={on} onClick={toggle}>
      <Icon name={on ? 'unmute' : 'mute'} small />
    </button>
  );
}
