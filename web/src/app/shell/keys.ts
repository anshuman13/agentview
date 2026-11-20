export const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

export const keyText = (key: string, mac = MAC) => (mac ? key : key.replace(/⌘/g, 'Ctrl+'));

export function ariaKeys(key: string, mac = MAC) {
  const mods = [key.includes('⌘') && (mac ? 'Meta' : 'Control'), key.includes('⌥') && 'Alt', key.includes('⇧') && 'Shift'];
  return [...mods.filter(Boolean), key.replace(/[⌘⌥⇧]/g, '')].join('+');
}
