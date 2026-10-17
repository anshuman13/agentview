export type ObserveConfig = {
  grafana?: { url?: string; query?: string; dashboards?: { title: string; url: string; uid?: string }[]; lokiSelector?: string; lokiUid?: string };
  sentry?: { org?: string; project?: string; url?: string };
};

export type SnowflakeAuth = 'pat' | 'password';

export type SnowflakeConfig = {
  account: string;
  user: string;
  warehouse: string;
  database: string;
  schema: string;
  role: string;
  auth: SnowflakeAuth;
  secret?: string;
};

export type SnowflakeInfo = Omit<SnowflakeConfig, 'secret'> & { hasSecret: boolean };

export type ObserveInfo = {
  repo: string;
  config: ObserveConfig | null;
  guess: ObserveConfig;
  repos: string[];
  file: string;
  sentryToken: boolean;
  sentryServer: 'config' | 'npx' | 'none';
  grafanaServer: boolean;
  snowflake: SnowflakeInfo;
  inClaude: { sentry: boolean; snowflake: boolean };
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

export type SentryIssues = { via: 'mcp' | 'rest'; issues: SentryIssue[]; note?: string };

export type SentryDetails = { via: 'mcp' | 'rest'; text: string };

export type GrafanaDashboard = { uid: string; title: string; url: string; folder?: string };

export type LogLine = { ts: string; line: string; level?: string };

export type LogPattern = { pattern: string; count: number };

export type GrafanaDashboards = { dashboards: GrafanaDashboard[]; link?: string };

export type GrafanaLogs = { logs: LogLine[]; link?: string; scanned: number };

export type GrafanaPatterns = { patterns: LogPattern[]; source: string; link?: string };

export type SnowflakeResult = { columns: string[]; rows: unknown[][]; truncated: boolean; ms: number };

export type SnowflakeObjects = { names: string[] };
