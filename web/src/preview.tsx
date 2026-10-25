import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { setAssistantStore } from './assistant';
import { SampleStore } from './assistant/sample';
import { Assistant, AssistantNav } from './panes/Assistant';

// Codex with sample data for screenshots: /preview.html?theme=light. Headless Chrome windows are at least 500px
// wide, so ?w=390 renders the page in a frame of that width.
const params = new URLSearchParams(location.search);
const w = params.get('w');
params.delete('w');
setAssistantStore(new SampleStore());

createRoot(document.getElementById('root')!).render(w ? (
  <iframe src={`?${params}`} style={{ width: `${w}px`, height: '100vh', border: 0, display: 'block' }} />
) : (
  <div className="workbench embed codex-preview">
    <div className="body">
      <aside className="sidebar">
        <AssistantNav />
      </aside>
      <div className="editor as-editor shown">
        <Assistant />
      </div>
    </div>
  </div>
));
