import { useEffect, useState } from 'react';
import { useAssistantStore } from '../../data';
import { useView } from '../../view';

const NO_HITS = new Map<string, string>();

// What the hub finds in the transcripts of the filter's profiles for the query, by profile:id with a snippet; empty until it answers.
export function useTranscriptHits(query: string) {
  const store = useAssistantStore();
  const { filter } = useView();
  const [found, setFound] = useState({ q: '', hits: NO_HITS });
  const text = query.trim();
  const profile = filter === 'all' ? undefined : filter;
  const q = `${filter}|${text}`;
  useEffect(() => {
    if (!text) return;
    let live = true;
    const t = setTimeout(() => {
      store.searchTranscripts(text, profile).then((hits) => live && setFound({ q, hits: new Map(hits.map((h) => [`${h.profile}:${h.id}`, h.snippet])) }), () => {});
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, text, profile, store]);
  return found.q === q ? found.hits : NO_HITS;
}
