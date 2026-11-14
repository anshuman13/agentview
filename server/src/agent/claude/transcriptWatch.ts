import path from 'node:path';
import { watch, type FSWatcher } from 'node:fs';
import type { SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentHost, History } from '../types.js';
import { JsonlTail } from './tail.js';
import { countAll, lastUuid, projectDir, sessionMessages, subagentMessages, workflowAgents, workflowSize, type SubFile, type WorkflowFile, type WorkflowRun } from './history.js';
import { RUN_ID, workflowEvents, workflowName, type historyFrom } from './transcript.js';

export type WatchOwner = {
  host: AgentHost;
  isClosed(): boolean;
  attached(): boolean;
  taskCount(): number;
  restart(): void;
  history(...args: Parameters<typeof historyFrom>): History;
};

// Follows the session's transcript and workflow files on disk and rebuilds the history when another process changes them.
export class TranscriptWatch {
  private transcript: FSWatcher | null = null;
  private watchedId: string | undefined;
  private transcriptTimer: NodeJS.Timeout | undefined;
  private workflowTimer: NodeJS.Timeout | undefined;
  private rewatchTimer: NodeJS.Timeout | undefined;
  private seen = '';
  private seenSubs = 0;
  private endedAt = 0;
  private dirty = true;
  private log: JsonlTail | null = null;
  private chain: { entries: any[]; n: number; msgs: SessionMessage[] } | null = null;
  private subFiles = new Map<string, SubFile>();
  private workflowFiles = new Map<string, WorkflowFile>();
  private liveWorkflowFiles = new Map<string, WorkflowFile>();
  private runCalls = new Map<string, string>();
  private unplaced = new Set<string>();

  constructor(private owner: WatchOwner) {}

  get active() {
    return this.transcript !== null;
  }

  private get state() {
    return this.owner.host.state;
  }

  private get cwd() {
    return this.owner.host.cwd;
  }

  watchHistory(on: boolean) {
    clearTimeout(this.rewatchTimer);
    const sessionId = this.state.session.sessionId;
    if (!on || !sessionId || this.owner.isClosed()) {
      this.transcript?.close();
      this.transcript = null;
      this.log = null;
      this.chain = null;
      this.subFiles = new Map();
      this.workflowFiles = new Map();
      this.liveWorkflowFiles = new Map();
      this.runCalls = new Map();
      this.unplaced = new Set();
      clearTimeout(this.workflowTimer);
      this.dirty = true;
      return;
    }
    if (this.transcript && this.watchedId === sessionId) return;
    // A new session id (after /clear) needs a watcher on its own transcript.
    this.transcript?.close();
    this.watchedId = sessionId;
    try {
      this.transcript = watch(projectDir(this.cwd), { recursive: true }, (_, file) => {
        if (file && !file.startsWith(sessionId)) return;
        // Workflow agents write often; syncWorkflows owns their files and the next transcript sync picks them up.
        if (file?.includes('/subagents/workflows/')) {
          clearTimeout(this.workflowTimer);
          this.workflowTimer = setTimeout(() => void this.syncWorkflows(), 300);
          return;
        }
        clearTimeout(this.transcriptTimer);
        this.transcriptTimer = setTimeout(() => void this.syncTranscript(false), 300);
      }).on('error', () => {
        // A watcher error would otherwise end live updates, workflow agents and build records with them, until a restart.
        this.watchHistory(false);
        this.rewatchTimer = setTimeout(() => this.watchHistory(true), 5000);
      });
    } catch {
      return;
    }
    void this.syncTranscript(false);
    void this.syncWorkflows();
  }

  settled() {
    this.endedAt = Date.now();
    setTimeout(() => void this.syncTranscript(true), 500);
  }

  async loadHistory(sessionId: string) {
    const { entries, subs, runs, size } = await this.readTranscript(sessionId);
    const msgs = await this.messages(sessionId, entries);
    this.dirty = false;
    this.seen = lastUuid(msgs) ?? '';
    this.seenSubs = size;
    return this.owner.history(msgs, subs, runs);
  }

  // Adds and updates the agents of running workflows without a rebuild, so they show while a turn runs.
  private async syncWorkflows() {
    const sessionId = this.state.session.sessionId;
    if (!sessionId || this.owner.isClosed()) return;
    const wf = await workflowAgents(this.cwd, sessionId, this.liveWorkflowFiles).catch(() => null);
    if (!wf?.runs.length || this.owner.isClosed() || this.state.session.sessionId !== sessionId) return;
    // Only runs with a file that changed since the last pass are rebuilt, and runs still waiting for their Workflow call.
    const runs = wf.runs.filter((r) => wf.fresh.has(r.runId) || this.unplaced.has(r.runId));
    if (runs.some((r) => !this.runCalls.has(r.runId))) {
      for (const e of this.state.events) {
        if (e.kind !== 'tool_result') continue;
        const runId = e.text.match(RUN_ID)?.[1];
        if (runId) this.runCalls.set(runId, e.toolUseId);
      }
    }
    for (const run of runs) {
      const call = this.owner.host.eventById(this.runCalls.get(run.runId) ?? '');
      if (call?.kind !== 'tool_use' || call.name !== 'Workflow') {
        this.unplaced.add(run.runId);
        continue;
      }
      this.unplaced.delete(run.runId);
      // One run that fails to push must not stop the runs after it.
      try {
        this.pushWorkflowRun(run, workflowName(call.input), call.at);
      } catch (err) {
        console.error(`workflow ${run.runId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private pushWorkflowRun(run: WorkflowRun, group: string, callAt: number) {
    const host = this.owner.host;
    for (const ev of workflowEvents(run, group, callAt)) {
      const have = host.eventById(ev.id);
      if (!have) host.pushEvent(ev, { release: false });
      else if (JSON.stringify(have) !== JSON.stringify(ev)) {
        Object.assign(have, ev);
        host.emit({ type: 'event', event: have });
      }
    }
  }

  private async syncTranscript(ownTurn: boolean) {
    const sessionId = this.state.session.sessionId;
    if (!sessionId || this.owner.isClosed() || this.state.session.running) return;
    const t = await this.readTranscript(sessionId).catch(() => null);
    if (!t || this.state.session.running) return;
    this.dirty ||= t.read !== 'same' || t.changed;
    if (!this.dirty) return;
    const { subs, runs, size } = t;
    const msgs = await this.messages(sessionId, t.entries).catch(() => null);
    const last = msgs && lastUuid(msgs);
    if (!msgs || !last || this.state.session.running) return;
    this.dirty = false;
    const subsMoved = !this.owner.attached() && size !== this.seenSubs;
    this.seenSubs = size;
    if (last === this.seen && !subsMoved) return;
    if (last !== this.seen) {
      // The CLI's last transcript write lands just before `result`, so the watcher fires before the own-turn sync.
      const baseline = ownTurn || !this.seen || this.owner.taskCount() > 0 || Date.now() - this.endedAt < 3000;
      this.seen = last;
      if (baseline) return;
    }
    this.owner.host.replaceHistory(this.owner.history(msgs, subs, runs));
    if (this.owner.attached()) this.owner.restart();
  }

  // Only bytes appended since the last read are parsed; unchanged subagent files are not re-read.
  private async readTranscript(sessionId: string) {
    const file = path.join(projectDir(this.cwd), `${sessionId}.jsonl`);
    if (this.log?.file !== file) {
      this.log = new JsonlTail(file);
      this.subFiles = new Map();
      this.workflowFiles = new Map();
    }
    const log = this.log;
    const [read, sub, wf] = await Promise.all([log.read(), subagentMessages(this.cwd, sessionId, this.subFiles), workflowAgents(this.cwd, sessionId, this.workflowFiles)]);
    const { subs, changed } = sub;
    return { read, entries: log.entries, subs, runs: wf.runs, size: countAll(subs) + workflowSize(wf.runs), changed: changed || wf.changed };
  }

  // The conversation chain only changes when the transcript does; a subagent write alone reuses the last one.
  private async messages(sessionId: string, entries: any[]) {
    const c = this.chain;
    if (c?.entries === entries && c.n === entries.length) return c.msgs;
    const n = entries.length;
    const msgs = await sessionMessages(sessionId, this.cwd, entries.slice());
    this.chain = { entries, n, msgs };
    return msgs;
  }
}
