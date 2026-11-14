import { useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { notice } from '../../app/store';
import { errText } from '../../../../shared/util';
import { append } from './composerLogic';
import { uploadPaste } from '../chatApi';

export function useUploads(setText: Dispatch<SetStateAction<string>>, ta: RefObject<HTMLTextAreaElement | null>) {
  const [uploading, setUploading] = useState(0);
  const attach = async (list: File[]) => {
    setUploading((n) => n + list.length);
    for (const f of list) {
      try {
        const body = await uploadPaste(f);
        setText((t) => append(t, `[${f.type.startsWith('image/') ? 'Image' : 'File'}: ${body.path}] `));
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
