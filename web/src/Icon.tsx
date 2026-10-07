const paths: Record<string, string> = {
  agent: 'M12 2a2 2 0 0 1 2 2v1h3a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h3V4a2 2 0 0 1 2-2zm-5 5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H7zm2 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
  chat: 'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v9h2v2.6L8.3 15H20V6H4z',
  files: 'M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10l-7-7zm0 2.4L17.6 10H13V5.4zM6 5h5v6h7v8H6V5z',
  file: 'M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10l-7-7zm0 2.4L17.6 10H13V5.4zM6 5h5v6h7v8H6V5z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm7.9 9h-3.4a15.6 15.6 0 0 0-1.3-6A8 8 0 0 1 19.9 11zM12 4c1.2 1.4 2.3 4 2.5 7h-5C9.7 8 10.8 5.4 12 4zM8.8 5a15.6 15.6 0 0 0-1.3 6H4.1A8 8 0 0 1 8.8 5zM4.1 13h3.4c.1 2.3.6 4.4 1.3 6A8 8 0 0 1 4.1 13zM12 20c-1.2-1.4-2.3-4-2.5-7h5c-.2 3-1.3 5.6-2.5 7zm3.2-1c.7-1.6 1.2-3.7 1.3-6h3.4a8 8 0 0 1-4.7 6z',
  sync: 'M12 4a8 8 0 0 1 6.9 4H16v2h6V4h-2v2.3A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8zm8 8a8 8 0 0 1-14.9 4H8v-2H2v6h2v-2.3A10 10 0 0 0 22 12h-2z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z',
};

export function Icon({ name, small }: { name: string; small?: boolean }) {
  const s = small ? 14 : 24;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden className="icon">
      <path d={paths[name] ?? ''} />
    </svg>
  );
}
