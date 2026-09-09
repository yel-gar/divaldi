export function formatBytes(bytes: number, digits = 1): string {
  if (bytes <= 0) {
    return '0 ' + 'МБ';
  }
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  const rounded = index === 0 ? Math.round(value) : Number(value.toFixed(digits));
  return `${rounded} ${units[index]}`;
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '00:00';
  }
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '0 МБ/с';
  }
  return `${formatBytes(bytesPerSecond)}/с`;
}

export function getFileExtension(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '';
}
