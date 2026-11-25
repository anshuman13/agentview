import { describe, expect, it } from 'bun:test';
import { dragsFiles, receiptFiles } from './travelLogic';

const file = (name: string, type: string) => new File(['x'], name, { type });

describe('dropped receipts', () => {
  it('keeps images and PDFs, as Add files does', () => {
    const kept = receiptFiles([file('a.jpg', 'image/jpeg'), file('b.pdf', 'application/pdf'), file('c.HEIC', ''), file('d.pdf', ''), file('e.txt', 'text/plain'), file('f.zip', 'application/zip')]);
    expect(kept.map((f) => f.name)).toEqual(['a.jpg', 'b.pdf', 'c.HEIC', 'd.pdf']);
  });

  it('shows the hint only for a drag that carries files', () => {
    expect(dragsFiles(['Files'])).toBe(true);
    expect(dragsFiles(['text/plain', 'text/uri-list'])).toBe(false);
    expect(dragsFiles(undefined)).toBe(false);
  });
});
