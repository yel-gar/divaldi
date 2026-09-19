import { extractApiErrorMessage } from './api-error';

describe('extractApiErrorMessage', () => {
  const error = (body: unknown, status = 400): never =>
    ({ error: body, status, message: 'Http failure response' }) as never;

  it('returns a network error message when the server is unreachable', () => {
    expect(extractApiErrorMessage(error({}, 0))).toBe('Не удалось связаться с сервером');
  });

  it('returns a generic message for server errors', () => {
    expect(extractApiErrorMessage(error({}))).toBe('Ошибка сервера');
    expect(extractApiErrorMessage(error({ detail: 'Traceback ...' }, 502))).toBe('Ошибка сервера');
  });

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

  it('falls back to backend message and generic text for other shapes', () => {
    expect(extractApiErrorMessage(error({ message: 'Login OK' }, 400))).toBe('Login OK');
    expect(extractApiErrorMessage(error({}))).toBe('Ошибка сервера');
  });
});
