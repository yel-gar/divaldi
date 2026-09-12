import { extractApiErrorMessage } from './api-error';

describe('extractApiErrorMessage', () => {
  const error = (body: unknown): never =>
    ({ error: body, message: 'Http failure response' }) as never;

  it('returns a string detail as-is', () => {
    expect(extractApiErrorMessage(error({ detail: 'Incorrect username or password' }))).toBe(
      'Incorrect username or password'
    );
  });

  it('returns the first validation message for array detail', () => {
    expect(
      extractApiErrorMessage(
        error({
          detail: [
            {
              loc: ['body', 'username'],
              msg: 'String should have at most 32 characters',
              type: 'string_too_long'
            }
          ]
        })
      )
    ).toBe('String should have at most 32 characters');
  });

  it('falls back to body and http message for other shapes', () => {
    expect(extractApiErrorMessage(error({ message: 'Login OK' }))).toBe('Login OK');
    expect(extractApiErrorMessage(error({}))).toBe('Http failure response');
  });
});
