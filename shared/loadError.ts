const NETWORK = /^(failed to fetch|load failed|networkerror|failed to connect|unable to resolve host)/i;
const TIMEOUT = /\btimed? ?out\b/i;

// A load or write error in plain words: a dropped link or a Mac that stopped answering; the server's own text is kept.
export const loadErrorText = (raw: string) => (NETWORK.test(raw) ? "Can't reach the Mac" : TIMEOUT.test(raw) ? 'The Mac took too long to answer' : raw);
