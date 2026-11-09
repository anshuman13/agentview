import { useState } from 'react';
import { MEETING_CHIPS, type MeetingChip } from '../../data/meetings/meetings';
import { save, storedStrings } from '../../../ui/util';

const CHIPS_KEY = 'agentview.meetingFilters';

export function useMeetingChips() {
  const [chips, setChips] = useState(() => MEETING_CHIPS.filter((c) => storedStrings(CHIPS_KEY).includes(c)));
  const setFilters = (next: MeetingChip[]) => {
    setChips(next);
    save(CHIPS_KEY, next);
  };
  const toggleChip = (c: MeetingChip) => setFilters(chips.includes(c) ? chips.filter((x) => x !== c) : MEETING_CHIPS.filter((x) => x === c || chips.includes(x)));
  return { chips, setFilters, toggleChip };
}
