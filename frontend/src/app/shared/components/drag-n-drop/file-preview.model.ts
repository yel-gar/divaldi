export type PreviewKind = 'pdf' | 'docx' | 'spreadsheet' | 'image';

const PREVIEWABLE_EXTENSIONS: Record<string, PreviewKind> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.xls': 'spreadsheet',
  '.xlsx': 'spreadsheet',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image'
};

const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

export function previewKindFor(extension: string): PreviewKind | null {
  return PREVIEWABLE_EXTENSIONS[extension] ?? null;
}

export function mimeTypeFor(extension: string): string {
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}
