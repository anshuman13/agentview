import { hideSnack, useSnack } from '../view';

// The one snack at the bottom of the screen, with Undo when the change can be taken back.
export function SnackBar() {
  const s = useSnack();
  if (!s) return null;
  return (
    <div className="as-snack" key={s.id}>
      <span>{s.text}</span>
      {s.undo && <button onClick={() => { s.undo!(); hideSnack(); }}>Undo</button>}
    </div>
  );
}
