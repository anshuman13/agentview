import { useState, type RefObject } from 'react';
import { notice } from '../../app/store';
import { errText } from '../../../../shared/util';
import { attachMark } from '../../../../shared/attachMark';
import { uploadPaste } from '../chatApi';

export function useUploads(addMark: (mark: string) => void, ta: RefObject<HTMLTextAreaElement | null>) {
  const [uploading, setUploading] = useState(0);
  const attach = async (list: File[]) => {
    setUploading((n) => n + list.length);
    for (const f of list) {
      try {
        const body = await uploadPaste(f);
        addMark(attachMark(f.type, body.path));
      } catch (err) {
        notice(`Could not attach ${f.name || 'the file'}: ${errText(err)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    ta.current?.focus();
  };
  return { uploading, attach };
}
