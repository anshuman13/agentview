import { useEffect, useRef } from 'react';
import { command } from '../../ui/util';
import { deepLink } from '../deepLinks';
import { isPage, pageOn } from '../pages';
import { VIEWS } from './ActivityBar';

// Applied once the first init is in, so the chat switch does not undo it on the phone.
export function useDeepLink(chat: string) {
  const linked = useRef(false);
  useEffect(() => {
    if (!chat || linked.current) return;
    linked.current = true;
    const id = deepLink.page && isPage(deepLink.page) && pageOn(deepLink.page) ? `page:${deepLink.page}` : VIEWS.some((v) => v.id === deepLink.view) ? `view:${deepLink.view}` : null;
    if (id) command(id);
  }, [chat]);
}
