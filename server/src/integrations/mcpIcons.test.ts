import { expect, it } from 'bun:test';
import { iconDomain } from './mcpIcons';

it('iconDomain', () => {
  expect(iconDomain('claude.ai Google Drive')).toBe('drive.google.com');
  expect(iconDomain('claude.ai Slack')).toBe('slack.com');
  expect(iconDomain('claude.ai Kiwi.com')).toBe('kiwi.com');
  expect(iconDomain('claude.ai Asana (2)')).toBe('asana.com');
  expect(iconDomain('grafana_prod', 'https://mcp.prod.nube.tech/mcp/grafana')).toBe('grafana.com');
  expect(iconDomain('piscina_prod', 'https://mcp.prod.nube.tech/mcp/piscina')).toBe('nube.tech');
  expect(iconDomain('aimlinterviews', 'npx -y aimlinterviews-mcp')).toBeNull();
  expect(iconDomain('claude.ai Adobe for creativity')).toBe('adobe.com');
  expect(iconDomain('claude.ai Work thing')).toBeNull();
});
