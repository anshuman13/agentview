export const WOKE_UP = /^\w+ woke up/;
export const isNoteText = (text: string) => ['Compact', 'Loop ', 'Goal', 'Usage limit', 'Logged out'].some((p) => text.startsWith(p));
