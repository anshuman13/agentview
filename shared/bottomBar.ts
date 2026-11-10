export type BarState = { focused: boolean; dismissed: boolean; text: boolean };
export type BarEvent = 'focus' | 'blur' | 'keyboardUp' | 'keyboardDown' | 'textEmpty' | 'textFilled';

export const barIdle: BarState = { focused: false, dismissed: false, text: false };

export function barState(state: BarState, event: BarEvent): BarState {
  switch (event) {
    case 'focus': return { ...state, focused: true, dismissed: false };
    case 'blur': return { ...state, focused: false, dismissed: false };
    case 'keyboardUp': return { ...state, dismissed: false };
    case 'keyboardDown': return { ...state, dismissed: true };
    case 'textEmpty': return { ...state, text: false };
    case 'textFilled': return { ...state, text: true };
  }
}

export const barHidden = (state: BarState) => state.text || (state.focused && !state.dismissed);
