import { useSyncExternalStore } from 'react';

let opened: string[] = [];
let openedChat = '';
const openedSubs = new Set<() => void>();
export const getOpened = () => opened;
export const getOpenedChat = () => openedChat;
export const setOpenedChat = (chat: string) => void (openedChat = chat);
export function setOpened(files: string[]) {
  opened = files;
  openedSubs.forEach((l) => l());
}
const subscribe = (l: () => void) => (openedSubs.add(l), () => void openedSubs.delete(l));
export const useOpened = () => useSyncExternalStore(subscribe, () => opened);
