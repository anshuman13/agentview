export const listTerms = (url: string) => fetch(url);

export const createTerm = (url: string) => fetch(url, { method: 'POST' });

export const closeTerm = (url: string) => fetch(url, { method: 'DELETE' });
