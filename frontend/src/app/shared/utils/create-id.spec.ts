import { createId } from './create-id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('createId', () => {
  it('returns a UUID in secure contexts', () => {
    expect(createId()).toMatch(UUID_PATTERN);
  });

  it('returns unique ids when crypto.randomUUID is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const first = createId();
      const second = createId();

      expect(first).not.toBe('');
      expect(first).not.toBe(second);
      expect(createId()).not.toBe(first);
    } finally {
      if (descriptor) {
        Object.defineProperty(crypto, 'randomUUID', descriptor);
      } else {
        delete (crypto as { randomUUID?: unknown }).randomUUID;
      }
    }
  });
});
