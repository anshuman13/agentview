import { createStore } from '../ui/createStore';

const opened = createStore<string[]>([]);
let openedChat = '';
export const getOpened = opened.get;
export const getOpenedChat = () => openedChat;
export const setOpenedChat = (chat: string) => void (openedChat = chat);
export const setOpened = opened.set;
export const useOpened = () => opened.use();
