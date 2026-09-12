import { HttpErrorResponse } from '@angular/common/http';

export function extractApiErrorMessage(error: HttpErrorResponse): string {
  const detail = error.error?.detail;
  if (typeof detail === 'string' && detail) {
    return detail;
  }
  if (Array.isArray(detail) && detail.length > 0) {
    return detail[0]?.msg ?? 'Проверьте корректность введённых данных';
  }
  return error.error?.message || error.message || 'Неизвестная ошибка';
}
