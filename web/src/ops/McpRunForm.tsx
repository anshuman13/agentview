import { useMemo, useState } from 'react';
import type { McpTool } from '../../../shared/protocol';
import { Icon } from '../ui/Icon';
import { post, share } from './mcpActions';
import { argsOf, fieldsOf, initialValues, slug, toolId, type Field } from './mcpHelpers';

type Out = { text: string; isError: boolean; args: Record<string, unknown> };

export function RunForm({ server, tool }: { server: string; tool: McpTool }) {
  const fields = useMemo(() => fieldsOf(tool.inputSchema), [tool]);
  const [values, setValues] = useState(() => initialValues(fields));
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [out, setOut] = useState<Out | null>(null);
  const set = (k: string, v: string | boolean) => { setValues((o) => ({ ...o, [k]: v })); setArmed(false); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    let args: Record<string, unknown>;
    try { args = argsOf(fields, values); } catch (err) { return setError((err as Error).message); }
    if (tool.destructive && !armed) return setArmed(true);
    setArmed(false);
    setBusy(true);
    post('/api/mcp/call', { server, tool: tool.name, args })
      .then((r: Out) => setOut({ text: r.text, isError: r.isError, args }), (err) => setError(err.message))
      .finally(() => setBusy(false));
  };
  const lead = (o: Out) => `${toolId(server, tool.name)} run from the MCP tab with ${JSON.stringify(o.args).slice(0, 200)} ${o.isError ? 'failed with' : 'returned'}`;
  const input = (f: Field) => {
    const v = values[f.name];
    const str = typeof v === 'string' ? v : '';
    if (f.kind === 'bool') return <input type="checkbox" checked={!!v} onChange={(e) => set(f.name, e.target.checked)} />;
    if (f.kind === 'enum') return (
      <select value={str} onChange={(e) => set(f.name, e.target.value)}>
        {!f.required && <option value="">Not set</option>}
        {f.options!.map((o) => <option key={JSON.stringify(o)} value={JSON.stringify(o)}>{String(o)}</option>)}
      </select>
    );
    if (f.kind === 'long' || f.kind === 'json') return <textarea value={str} rows={f.kind === 'json' ? 3 : 4} placeholder={f.kind === 'json' ? 'JSON' : undefined} onChange={(e) => set(f.name, e.target.value)} spellCheck={false} />;
    return <input type={f.kind === 'text' ? 'text' : 'number'} step={f.kind === 'integer' ? 1 : 'any'} value={str} onChange={(e) => set(f.name, e.target.value)} spellCheck={false} />;
  };
  return (
    <form className="mcp-run" onSubmit={submit}>
      {fields.map((f) => (
        <label key={f.name} className={`mcp-field ${f.kind === 'bool' ? 'bool' : ''}`}>
          {f.kind === 'bool' && input(f)}
          <span className="k"><span className="mono">{f.name}</span>{f.required && <span className="req" title="Required">*</span>}<span className="ty mono">{f.kind === 'long' ? 'text' : f.kind}</span></span>
          {f.kind !== 'bool' && input(f)}
          {f.description && <span className="d">{f.description}</span>}
        </label>
      ))}
      {!fields.length && <div className="muted">This tool takes no input.</div>}
      <div className="mcp-run-acts">
        <button type="submit" className={armed ? 'btn danger' : 'btn primary'} disabled={busy}>
          <Icon name={busy ? 'loading' : armed ? 'warning' : 'play'} small spin={busy} /> {busy ? 'Running' : armed ? 'Confirm run' : 'Run'}
        </button>
        {armed && <span className="bad">This tool can change or delete data. Click again to run it.</span>}
        {error && <span className="bad">{error}</span>}
      </div>
      {out && (
        <div className="mcp-run-out">
          <pre className={out.isError ? 'bad' : ''}>{out.text || '(no output)'}</pre>
          <button type="button" className="btn" onClick={() => void share(lead(out), out.text, `${slug(server)}-${tool.name}.txt`)}><Icon name="insert" small /> Add result to chat</button>
        </div>
      )}
    </form>
  );
}
