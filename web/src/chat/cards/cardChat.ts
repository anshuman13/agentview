import { createContext } from 'react';

// The chat a card answers for, when it is not the one on screen (the session list's answer card).
export const CardChat = createContext<string | undefined>(undefined);
