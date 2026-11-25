import { useRef, useState, type DragEvent } from 'react';
import { notice } from '../app/store';
import { dragsFiles, receiptFiles } from './travelLogic';

// Drop target for receipt files. `over` is true only while files are dragged over it; an inner target
// that took the drop (preventDefault) leaves the outer one to reset its hint only.
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const reset = () => { depth.current = 0; setOver(false); };
  if (!enabled) return { over: false, props: {} };
  return {
    over,
    props: {
      onDragEnter: (e: DragEvent) => {
        if (!dragsFiles(e.dataTransfer?.types)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e: DragEvent) => { if (dragsFiles(e.dataTransfer?.types)) e.preventDefault(); },
      onDragLeave: (e: DragEvent) => {
        if (!dragsFiles(e.dataTransfer?.types)) return;
        depth.current -= 1;
        if (depth.current <= 0) reset();
      },
      onDrop: (e: DragEvent) => {
        const taken = e.defaultPrevented;
        reset();
        if (taken || !dragsFiles(e.dataTransfer?.types)) return;
        e.preventDefault();
        const files = receiptFiles([...e.dataTransfer.files]);
        if (files.length) onFiles(files);
        else notice('Only images and PDFs can be added as receipts');
      },
    },
  };
}
