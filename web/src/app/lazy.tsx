import { lazy, useState, type ComponentType } from 'react';

// Loads when the browser is idle, or at once when the component renders first, and renders without suspending once loaded, so a page's enter animation never follows a skeleton.
export function prefetch<P extends object>(load: () => Promise<ComponentType<P>>) {
  let ready: ComponentType<P> | undefined;
  let p: Promise<ComponentType<P>> | undefined;
  const start = () => (p ??= load().then((c) => (ready = c)));
  if (typeof requestIdleCallback === 'function') requestIdleCallback(start);
  else setTimeout(start, 1500);
  const Lazy = lazy(() => start().then((c) => ({ default: c }))) as unknown as ComponentType<P>;
  return function Prefetched(props: P) {
    const [C] = useState(() => ready ?? Lazy);
    return <C {...props} />;
  };
}

// Views that render chat markdown wait for marked too, so replies never show as plain text first.
const withMd = <T,>(view: Promise<T>) => Promise.all([view, import('../chat/transcript/md')]).then(([m]) => m);

export const Brief = lazy(() => withMd(import('../sessions/brief/Brief')).then((m) => ({ default: m.Brief })));
export const AgentsPane = lazy(() => withMd(import('../sessions/AgentsPane')).then((m) => ({ default: m.AgentsPane })));
export const FileSwitcher = lazy(() => import('../workspace/FileSwitcher').then((m) => ({ default: m.FileSwitcher })));
export const Palette = lazy(() => import('./palette/Palette').then((m) => ({ default: m.Palette })));
export const GoalSheets = lazy(() => import('../sessions/GoalSheets').then((m) => ({ default: m.GoalSheets })));
export const Shortcuts = lazy(() => import('./shell/Shortcuts').then((m) => ({ default: m.Shortcuts })));
export const OpenChats = prefetch(() => import('../sessions/OpenChats').then((m) => m.OpenChats));
export const RepoPicker = lazy(() => import('../sessions/RepoPicker').then((m) => ({ default: m.RepoPicker })));
export const Runs = prefetch(() => import('../sessions/Runs').then((m) => m.Runs));
export const Sessions = prefetch(() => import('../sessions/Sessions').then((m) => m.Sessions));
export const AssistantNav = prefetch(() => import('../codex/nav').then((m) => m.AssistantNav));
export const AssistantCounts = lazy(() => import('../codex/nav').then((m) => ({ default: m.AssistantCounts })));
export const Assistant = prefetch(() => import('../codex/Codex').then((m) => m.Assistant));
export const FocusBar = lazy(() => import('../codex/focus').then((m) => ({ default: m.FocusBar })));
export const Explorer = lazy(() => import('../workspace/Explorer').then((m) => ({ default: m.Explorer })));
export const Changes = prefetch(() => import('../workspace/Changes').then((m) => m.Changes));
export const GitHub = prefetch(() => withMd(import('../ops/GitHub')).then((m) => m.GitHub));
export const Terminal = lazy(() => import('../workspace/Terminal').then((m) => ({ default: m.Terminal })));
export const CodePane = lazy(() => import('../workspace/CodePane').then((m) => ({ default: m.CodePane })));
export const BrowserPane = lazy(() => import('../workspace/BrowserPane').then((m) => ({ default: m.BrowserPane })));
export const Observe = lazy(() => import('../ops/Observe').then((m) => ({ default: m.Observe })));
export const Deploy = lazy(() => import('../ops/Deploy').then((m) => ({ default: m.Deploy })));
export const Sketches = lazy(() => import('../workspace/Sketches').then((m) => ({ default: m.Sketches })));
export const Builds = lazy(() => withMd(import('../sessions/Builds')).then((m) => ({ default: m.Builds })));
export const McpPage = lazy(() => import('../ops/McpStatus').then((m) => ({ default: m.McpPage })));
export const Settings = lazy(() => import('./shell/Settings').then((m) => ({ default: m.Settings })));
export const ConnectPopover = lazy(() => import('./shell/ConnectPopover').then((m) => ({ default: m.ConnectPopover })));
export const MacsPopover = lazy(() => import('./shell/MacsPopover').then((m) => ({ default: m.MacsPopover })));
export const Loading = () => <div className="loading">Loading…</div>;
export const DesignPage = lazy(() => import('../design/Stories').then((m) => ({ default: m.DesignPage })));
