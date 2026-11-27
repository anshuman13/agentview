import { useMemo } from 'react';
import { useStore } from '../../app/store';
import { Section } from '../../ui/Section';
import { Sheet } from '../../ui/Sheet';
import { chatImages } from '../composer/composerLogic';
import { UserImage } from '../transcript/UserRow';
import { relPath } from '../transcript/steps';

// Every image the chat read, wrote or was sent, newest first, each with its path (android ImagesUi.kt ImagesSheet).
export function ImagesPick({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const events = useStore((s) => s.events);
  const images = useMemo(() => chatImages(events), [events]);
  return (
    <Sheet label="Images" onClose={onClose} className="gl-sheet">
      <Section label="Images" count={images.length} />
      {images.map((p) => (
        <div key={p} className="bd-doc">
          <UserImage path={p} />
          <div className="gl-note">{relPath(p, cwd)}</div>
        </div>
      ))}
    </Sheet>
  );
}
