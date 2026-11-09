import { useMemo } from 'react';
import { useAssistantData } from '../../data';
import { type Meeting } from '../../data/wiki/wiki';
import { filterMeetings, groupMeetings, searchMeetings, trackedTopics, type MeetingChip } from '../../data/meetings/meetings';
import { capGroups, useWindow } from '../../../ui/useWindow';
import { useView } from '../../view';
import { useTranscriptHits } from './useTranscriptHits';

// The meetings matching the filters, grouped by day and cut to the rows shown so far.
export function useMeetingResults(mine: Meeting[], query: string, chips: MeetingChip[], active: string[], now: number) {
  const snap = useAssistantData();
  const { filter } = useView();
  const said = useTranscriptHits(query);
  const found = useMemo(() => {
    const filtered = filterMeetings(mine, snap.items, chips, now);
    const tracked = active.length ? filtered.filter((m) => trackedTopics(m, active).length) : filtered;
    return searchMeetings(tracked, query, said);
  }, [mine, snap.items, chips, now, query, active, said]);
  const groups = useMemo(() => groupMeetings(found, now), [found, now]);
  const total = useMemo(() => groups.reduce((n, g) => n + g.rows.length, 0), [groups]);
  const [shown, more] = useWindow(`${filter}|${query}|${active.join(',')}|${chips.join(',')}`);
  const visible = useMemo(() => capGroups(groups, shown, 'rows'), [groups, shown]);
  return { said, groups, total, shown, more, visible };
}
