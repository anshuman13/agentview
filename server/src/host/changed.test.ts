import { expect, it, vi } from 'vitest';
import { sendWhenChanged } from './changed.js';

it('sends only when the serialized value differs from the last one sent', () => {
  const send = vi.fn();
  const push = sendWhenChanged(send);
  push([{ id: 'a', running: false }]);
  push([{ id: 'a', running: false }]);
  expect(send).toHaveBeenCalledTimes(1);
  push([{ id: 'a', running: true }]);
  push([{ id: 'a', running: false }]);
  expect(send).toHaveBeenCalledTimes(3);
});
