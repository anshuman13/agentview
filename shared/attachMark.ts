// The marker an upload adds to a prompt: "[Image: path]" for an image type, else "[File: path]"; shared/fixtures/attach-mark.json holds the cases.
export const attachMark = (mime: string, path: string) => `[${mime.startsWith('image/') ? 'Image' : 'File'}: ${path}]`;
