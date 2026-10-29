import { Icon } from '../ui/Icon';

const BLUE = 'var(--file-blue)';
const YELLOW = 'var(--file-yellow)';
const PURPLE = 'var(--file-purple)';
const ORANGE = 'var(--file-orange)';
const GREEN = 'var(--file-green)';
const RED = 'var(--file-red)';
const PINK = 'var(--file-pink)';
const CYAN = 'var(--file-cyan)';
const GRAY = 'var(--file-gray)';
const FOLDER = 'var(--file-folder)';

type Kind = [icon: string, color: string];

const BY_NAME: Record<string, Kind> = {
  'package.json': ['json', GREEN],
  'package-lock.json': ['json', GRAY],
  'yarn.lock': ['lock', GRAY],
  'pnpm-lock.yaml': ['lock', GRAY],
  'cargo.lock': ['lock', GRAY],
  'poetry.lock': ['lock', GRAY],
  'uv.lock': ['lock', GRAY],
  'go.sum': ['lock', GRAY],
  dockerfile: ['package', BLUE],
  makefile: ['tools', GRAY],
  license: ['law', YELLOW],
  '.gitignore': ['git-commit', GRAY],
  '.gitattributes': ['git-commit', GRAY],
  '.npmrc': ['settings-gear', GRAY],
  '.nvmrc': ['settings-gear', GRAY],
  '.editorconfig': ['settings-gear', GRAY],
  '.prettierrc': ['settings-gear', GRAY],
  '.eslintrc': ['settings-gear', GRAY],
};

const BY_EXT: [RegExp, Kind][] = [
  [/^readme\.mdx?$/i, ['book', BLUE]],
  [/\.mdx?$/i, ['markdown', BLUE]],
  [/\.tsx?$/i, ['file-code', BLUE]],
  [/\.(jsx?|mjs|cjs)$/i, ['file-code', YELLOW]],
  [/\.json[c5]?$/i, ['json', YELLOW]],
  [/\.(css|scss|sass|less)$/i, ['symbol-color', PURPLE]],
  [/\.(html?|vue|svelte|astro)$/i, ['code', ORANGE]],
  [/\.py$/i, ['file-code', BLUE]],
  [/\.go$/i, ['file-code', CYAN]],
  [/\.rs$/i, ['file-code', ORANGE]],
  [/\.swift$/i, ['file-code', ORANGE]],
  [/\.kts?$/i, ['file-code', PURPLE]],
  [/\.(java|rb|c|cc|cpp|h|hpp|cs)$/i, ['file-code', RED]],
  [/\.(sh|bash|zsh|fish|bat|ps1)$/i, ['terminal', GREEN]],
  [/\.ya?ml$/i, ['settings', PURPLE]],
  [/\.(toml|ini|cfg|conf|properties)$/i, ['settings-gear', GRAY]],
  [/\.sql$/i, ['database', PINK]],
  [/\.(png|jpe?g|gif|svg|webp|ico|bmp|avif)$/i, ['file-media', PURPLE]],
  [/\.pdf$/i, ['file-pdf', RED]],
  [/\.(zip|tar|gz|tgz|bz2|7z|rar)$/i, ['file-zip', GRAY]],
  [/\.(lock|lockb)$/i, ['lock', GRAY]],
  [/\.env(\..*)?$/i, ['settings-gear', GRAY]],
  [/\.(txt|log|csv)$/i, ['file-text', GRAY]],
  [/\.(xml|plist|graphql|gql|prisma|proto)$/i, ['code', ORANGE]],
];

function kindOf(name: string): Kind {
  const base = name.split('/').pop() ?? name;
  const named = BY_NAME[base.toLowerCase()] ?? BY_NAME[base.toLowerCase().replace(/\..*$/, '')];
  if (named) return named;
  for (const [re, kind] of BY_EXT) if (re.test(base)) return kind;
  return ['file', GRAY];
}

export function FileIcon({ name, dir, open }: { name: string; dir?: boolean; open?: boolean }) {
  if (dir) return <Icon name={open ? 'folder-opened' : 'folder'} small color={FOLDER} />;
  const [icon, color] = kindOf(name);
  return <Icon name={icon} small color={color} />;
}
