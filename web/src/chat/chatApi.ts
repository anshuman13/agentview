import { api } from '../app/store';

export const fetchTodos = () => fetch(api('/api/git/todos')).then((r) => r.json());

export const fetchMemory = () => fetch(api('/api/memory')).then((r) => r.json());

export const fetchSavedSessions = () => fetch(api('/api/sessions')).then((r) => r.json());
