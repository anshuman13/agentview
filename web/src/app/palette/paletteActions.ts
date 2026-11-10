import { appSettings } from '../appSettings';
import { getState, notice, send, setUi } from '../store';
import { openGoal } from '../../sessions/goalLogic';
import { toggleNotify } from '../runtime/notify';
import { openMeeting, openTask, setView, type List } from '../../codex/view';
import { clock } from '../../codex/tasks/time';
import { ago, command } from '../../ui/util';
import { forkChat } from '../../chat/chatActions';
import { specPrompt } from '../../../../shared/specTasks';
import type { PaletteItem } from './paletteLogic';

const KIND_LABEL = { task: 'Task', meeting: 'Meeting', wiki: 'Wiki' };

export function itemMeta(i: PaletteItem) {
  const when = i.at == null ? '' : new Date(i.at).toDateString() === new Date().toDateString() ? clock(i.at) : ago(i.at);
  return [KIND_LABEL[i.kind], i.profile === 'work' ? 'Work' : 'Personal', when].filter(Boolean).join(' · ');
}

export function openItem(i: PaletteItem) {
  if (i.kind === 'task') openTask(i);
  else if (i.kind === 'meeting') openMeeting(i);
  else setView({ list: 'wiki', open: i.id, anchor: null });
  command('assistant');
}

export function perform(id: string) {
  const [kind, ...rest] = id.split(':');
  const arg = rest.join(':');
  if (kind === 'codex') {
    const add = arg === 'newtask';
    setView({ list: add ? 'tasks' : (arg as List), open: null, person: null });
    command('assistant');
    if (add) requestAnimationFrame(() => requestAnimationFrame(() => window.dispatchEvent(new Event('tasks:add'))));
    return;
  }
  if (kind === 'pin') {
    const chat = getState().live.find((c) => c.sessionId === arg);
    send(chat ? { type: 'view', id: chat.id } : { type: 'open_session', sessionId: arg });
  } else if (kind === 'model') send({ type: 'set_model', model: arg });
  else if (kind === 'effort') send({ type: 'set_effort', effort: arg });
  else if (kind === 'mode') send({ type: 'set_permission_mode', mode: arg });
  else if (id === 'newChat') send({ type: 'new_session' });
  else if (kind === 'newChat') {
    const p = appSettings.get().providers.find((o) => o.id === arg);
    if (p?.enabled) send({ type: 'new_session', provider: p.id });
    else notice(p?.note ?? 'That provider is not available');
  }
  else if (id === 'forkChat') forkChat();
  else if (id === 'compact') send({ type: 'prompt', text: '/compact' });
  else if (id === 'loop') send({ type: 'set_loop', on: !getState().session.loop.on });
  else if (id === 'review') send({ type: 'set_review', on: !getState().session.review });
  else if (id === 'goal') openGoal();
  else if (id === 'goalFile') setUi({ goalSheet: { mode: 'start', plan: getState().ui.openFile ?? undefined } });
  else if (id === 'spec') {
    send({ type: 'set_permission_mode', mode: 'plan' });
    window.dispatchEvent(new CustomEvent('agentview:insert', { detail: { text: specPrompt('') } }));
  }
  else if (id === 'stop') send({ type: 'interrupt' });
  else if (id === 'restart') send({ type: 'restart' });
  else if (id === 'file') setUi({ switcherOpen: true });
  else if (id === 'repo') setUi({ repoPicker: true });
  else if (id === 'notify') toggleNotify();
  else if (id === 'shortcuts') window.dispatchEvent(new Event('agentview:shortcuts'));
  window.dispatchEvent(new CustomEvent('agentview:command', { detail: { id } }));
}
