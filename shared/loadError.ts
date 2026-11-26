const NETWORK = /^(failed to fetch|load failed|networkerror|failed to connect|unable to resolve host|unexpected end of stream|connection reset)/i;
const TIMEOUT = /^(timeout|(read|connect) timed out|the operation timed out|signal timed out)/i;

// A load or write error in plain words: a dropped link or a Mac that stopped answering; the server's own text is kept.
export const loadErrorText = (raw: string) => (NETWORK.test(raw) ? "Can't reach the Mac" : TIMEOUT.test(raw) ? 'The Mac took too long to answer' : raw);
