import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { notice } from '../../app/store';
import { Confirm } from '../../ui/Confirm';
import { assistantStore } from '../../codex/data';
import { stampedNotes } from '../../codex/data/meetings/meetings';
import { showSnack } from '../../codex/view';
import { clock } from '../../codex/tasks/time';
import { readFlag } from '../../ui/util';
import type { Meeting } from '../../codex/data/wiki/wiki';
import { errText } from '../../../../shared/util';
import { append, currentMeeting, sharedTask } from './composerLogic';

type SetText = Dispatch<SetStateAction<string>>;

export function useSharedIntake(attach: (list: File[]) => Promise<void>) {
  const [shared, setShared] = useState<string | null>(null);
  useEffect(() => {
    const shell = (window as { AgentViewShell?: { takeShared?: () => string } }).AgentViewShell;
    if (!shell?.takeShared) return;
    const take = () => {
      try {
        const items = JSON.parse(shell.takeShared!() || '[]') as { name: string; type: string; data: string; text?: string }[];
        const texts = items.filter((it) => it.text).map((it) => it.text);
        if (texts.length) setShared((s) => (s === null ? texts.join('\n') : `${s}\n${texts.join('\n')}`));
        for (const it of items) {
          if (it.text) continue;
          else void attach([new File([Uint8Array.from(atob(it.data), (c) => c.charCodeAt(0))], it.name, { type: it.type })]);
        }
      } catch {
        notice('Could not read what was shared');
      }
    };
    take();
    window.addEventListener('agentview:shared', take);
    return () => window.removeEventListener('agentview:shared', take);
  }, []);
  return [shared, setShared] as const;
}

export function SharedConfirm({ shared, setShared, setText }: { shared: string; setShared: (s: string | null) => void; setText: SetText }) {
  const added = useRef(false);
  const meeting = useMemo(() => currentMeeting(assistantStore().snapshot().meetings, Date.now()), []);

  const addTask = async (raw: string) => {
    const { title, at } = sharedTask(raw);
    try {
      await assistantStore().capture(title, 'task', readFlag('assistant-personal', false) ? 'personal' : 'work', at);
      notice('Added to Tasks');
    } catch (err) {
      notice(`Not saved: ${errText(err)}. The text is back in the composer.`);
      setText((t) => append(t, `${raw} `));
    }
  };

  const addToNotes = async (raw: string, m: Meeting) => {
    try {
      const store = assistantStore();
      const cur = store.snapshot().meetings.find((x) => x.profile === m.profile && x.id === m.id) ?? m;
      const notes = stampedNotes(cur.notes, raw, Date.now());
      if (!notes) return;
      await store.editRow('meetings', cur, { notes });
      if (store.snapshot().meetings.find((x) => x.profile === cur.profile && x.id === cur.id)?.notes !== notes) throw new Error('the notes did not change');
      showSnack('Added to the notes');
    } catch (err) {
      notice(`Not saved: ${errText(err)}. The text is back in the composer.`);
      setText((t) => append(t, `${raw} `));
    }
  };

  return (
    <Confirm
      title="Shared text"
      detail={meeting ? `${shared}\n\nMeeting: ${meeting.title}, ${clock(meeting.starts_at!)}` : shared}
      icon="add"
      neutral
      action="Add as task"
      cancel="Send to chat"
      extra={meeting ? { label: 'Add to meeting notes', run: () => { added.current = true; return addToNotes(shared, meeting); } } : undefined}
      run={() => { added.current = true; return addTask(shared); }}
      onClose={() => {
        if (!added.current) setText((t) => append(t, `${shared} `));
        added.current = false;
        setShared(null);
      }}
    />
  );
}
