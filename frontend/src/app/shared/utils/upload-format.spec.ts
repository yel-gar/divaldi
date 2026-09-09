import { formatBytes, formatEta, formatSpeed, getFileExtension } from './upload-format';

const MB = 1024 * 1024;

describe('upload-format', () => {
  it('formats bytes into human readable units', () => {
    expect(formatBytes(0)).toBe('0 МБ');
    expect(formatBytes(500)).toBe('500 Б');
    expect(formatBytes(MB)).toBe('1 МБ');
    expect(formatBytes(26.4 * MB)).toBe('26.4 МБ');
  });

  it('formats ETA as mm:ss', () => {
    expect(formatEta(0)).toBe('00:00');
    expect(formatEta(18)).toBe('00:18');
    expect(formatEta(75)).toBe('01:15');
    expect(formatEta(Infinity)).toBe('00:00');
  });

  it('formats speed', () => {
    expect(formatSpeed(0)).toBe('0 МБ/с');
    expect(formatSpeed(4.2 * MB)).toBe('4.2 МБ/с');
  });

  it('extracts lowercase extensions', () => {
    expect(getFileExtension('report.PDF')).toBe('.pdf');
    expect(getFileExtension('noext')).toBe('');
  });
});
