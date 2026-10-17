export type ObserveConfig = {
  grafana?: { url?: string; dashboards?: { title: string; url: string }[]; lokiSelector?: string };
  sentry?: { org?: string; project?: string; url?: string };
};

export type ObserveInfo = {
  repo: string;
  config: ObserveConfig | null;
  guess: ObserveConfig;
  repos: string[];
  file: string;
  sentryToken: boolean;
};

export type SentryIssue = {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  count: number;
  userCount: number;
  lastSeen: string;
  permalink: string;
  level: string;
};
