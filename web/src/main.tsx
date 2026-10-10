import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './sidebar.css';
import './connect.css';
import './mobile.css';

createRoot(document.getElementById('root')!).render(<App />);
