export const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

export const keyText = (key: string, mac = MAC) =>
  mac ? key : key.replace(/[⌘⌥⇧]+/g, (m) => `${m.includes('⌘') ? 'Ctrl+' : ''}${m.includes('⌥') ? 'Alt+' : ''}${m.includes('⇧') ? 'Shift+' : ''}`);

export function ariaKeys(key: string, mac = MAC) {
  const mods = [key.includes('⌘') && (mac ? 'Meta' : 'Control'), key.includes('⌥') && 'Alt', key.includes('⇧') && 'Shift'];
  return [...mods.filter(Boolean), key.replace(/[⌘⌥⇧]/g, '')].join('+');
}
