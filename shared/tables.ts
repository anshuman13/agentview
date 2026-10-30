export const TABLES: Record<string, string[]> = {
  items: ['title', 'text', 'source', 'source_url', 'people', 'at', 'status', 'meeting_id', 'rolls', 'rolled_from', 'rank', 'draft'],
  facts: ['text', 'item_id', 'superseded_by', 'page_id', 'heading', 'sources', 'at', 'contested', 'state', 'replaces', 'added_by'],
  pages: ['title', 'section', 'summary', 'sort', 'state'],
  meetings: ['title', 'starts_at', 'ends_at', 'people', 'calendar_url', 'recorded_ms', 'notes', 'summary', 'decisions', 'transcript', 'tries', 'room', 'room_me', 'others'],
  actions: ['meeting_id', 'kind', 'target', 'title', 'body', 'fields', 'status', 'result_url'],
  people: ['name', 'slack_id', 'emails', 'calendar_names'],
  links: ['from_type', 'from_id', 'to_type', 'to_id', 'kind'],
  embeddings: ['owner_type', 'owner_id', 'model', 'vector'],
  jobs: ['name', 'schedule', 'prompt', 'enabled', 'next_run_at'],
  runs: ['job_id', 'started_at', 'finished_at', 'status', 'output'],
  chats: ['name', 'kind', 'url', 'summary', 'last_at'],
  briefs: ['kind', 'text', 'from_at', 'to_at'],
};

export const HUB_ONLY = ['rolls', 'rolled_from', 'rank'];
