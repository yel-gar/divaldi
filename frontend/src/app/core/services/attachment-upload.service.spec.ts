import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { AttachmentUploadService } from './attachment-upload.service';
import { UploadItem } from '../models/models';
import { environment } from '../../../environments/environment';

const SESSION_ID = 'd0a3f1e2-0000-4000-8000-123456789abc';
const POLL_INTERVAL_MS = 2000;

class FakeXhr {
  static instances: FakeXhr[] = [];

  constructor() {
    FakeXhr.instances.push(this);
  }

  status = 0;
  aborted = false;
  openedUrl = '';
  sent = false;
  sentBody: FormData | null = null;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  open(method: string, url: string): void {
    this.openedUrl = url;
  }

  send(body: FormData): void {
    this.sent = true;
    this.sentBody = body;
  }

  abort(): void {
    this.aborted = true;
  }

  static reset(): void {
    FakeXhr.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
  }

  static last(): FakeXhr {
    return FakeXhr.instances[FakeXhr.instances.length - 1];
  }
}

function makeItem(overrides: Partial<UploadItem> = {}): UploadItem {
  return {
    id: 'item-1',
    name: 'деталь.pdf',
    size: 1024,
    extension: '.pdf',
    file: new File(['content'], 'деталь.pdf', { type: 'application/pdf' }),
    status: 'uploading',
    uploaded: 0,
    ...overrides
  };
}

describe('AttachmentUploadService', () => {
  let service: AttachmentUploadService;
  let http: HttpTestingController;

  const uploadUrl = (attachmentId: number): string =>
    `${environment.apiUrl}/chats/${SESSION_ID}/uploads/${attachmentId}/uploaded`;
  const statusUrl = (attachmentId: number): string =>
    `${environment.apiUrl}/chats/${SESSION_ID}/uploads/${attachmentId}/status`;

  function requestParams(attachmentId = 7): void {
    http.expectOne(`${environment.apiUrl}/chats/${SESSION_ID}/uploads`).flush({
      attachment_id: attachmentId,
      params: { url: 'https://minio/upload', fields: { key: 'attachments/1', policy: 'p' } }
    });
  }

  function progressEvent(loaded: number, lengthComputable = true): ProgressEvent {
    return { loaded, lengthComputable } as ProgressEvent;
  }

  beforeEach(() => {
    FakeXhr.reset();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(AttachmentUploadService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
  });

  it('requests upload params with the file metadata', () => {
    const item = makeItem();

    service.upload(item, SESSION_ID).subscribe();

    const req = http.expectOne(`${environment.apiUrl}/chats/${SESSION_ID}/uploads`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      content_type: 'application/pdf',
      file_size: 1024,
      filename: 'деталь.pdf'
    });
    req.flush({
      attachment_id: 7,
      params: { url: 'https://minio/upload', fields: { key: 'attachments/1' } }
    });

    expect(FakeXhr.last().openedUrl).toBe('https://minio/upload');
    expect(FakeXhr.last().sent).toBe(true);
    const body = FakeXhr.last().sentBody as FormData;
    expect(body.get('key')).toBe('attachments/1');
    expect(body.get('file')).toBe(item.file);
  });

  it('falls back to a generic mime type for unknown extensions', () => {
    service.upload(makeItem({ extension: '.exe', name: 'virus.exe' }), SESSION_ID).subscribe();

    const req = http.expectOne(`${environment.apiUrl}/chats/${SESSION_ID}/uploads`);
    expect(req.request.body.content_type).toBe('application/octet-stream');
    req.flush({
      attachment_id: 7,
      params: { url: 'https://minio/upload', fields: {} }
    });
  });

  it('reports progress and completes when the storage upload succeeds', () => {
    const values: number[] = [];
    const progress: number[] = [];
    let completed = false;

    vi.useFakeTimers();
    service
      .upload(makeItem(), SESSION_ID, { onProgress: (bytes) => progress.push(bytes) })
      .subscribe({
        next: (value) => values.push(value),
        complete: () => (completed = true)
      });

    requestParams();
    const xhr = FakeXhr.last();

    xhr.upload.onprogress?.(progressEvent(512));
    expect(values).toEqual([512]);
    expect(progress).toEqual([512]);

    xhr.status = 204;
    xhr.onload?.();
    expect(values).toEqual([512, 1024]);
    expect(progress).toEqual([512, 1024]);

    http.expectOne(uploadUrl(7)).flush({ message: 'File uploaded' });
    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    http.expectOne(statusUrl(7)).flush({ status: 'completed' });

    expect(completed).toBe(true);
    vi.useRealTimers();
  });

  it('clamps reported progress to the file size and skips non-computable events', () => {
    const values: number[] = [];

    service.upload(makeItem(), SESSION_ID).subscribe((value) => values.push(value));

    requestParams();
    const xhr = FakeXhr.last();

    xhr.upload.onprogress?.(progressEvent(99999));
    xhr.upload.onprogress?.(progressEvent(256, false));

    expect(values).toEqual([1024]);
  });

  it('keeps polling while the file is still processing', () => {
    let polls = 0;
    let completed = false;

    vi.useFakeTimers();
    service.upload(makeItem(), SESSION_ID).subscribe({ complete: () => (completed = true) });

    requestParams();
    const xhr = FakeXhr.last();
    xhr.status = 200;
    xhr.onload?.();
    http.expectOne(uploadUrl(7)).flush({ message: 'File uploaded' });

    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      http.expectOne(statusUrl(7)).flush({ status: 'processing' });
      polls++;
    }

    expect(polls).toBe(3);
    expect(completed).toBe(false);
    vi.useRealTimers();
  });

  it('errors when the processing status reports an error', () => {
    let message: string | undefined;

    vi.useFakeTimers();
    service.upload(makeItem(), SESSION_ID).subscribe({ error: (err) => (message = err.message) });

    requestParams();
    const xhr = FakeXhr.last();
    xhr.status = 200;
    xhr.onload?.();
    http.expectOne(uploadUrl(7)).flush({ message: 'File uploaded' });

    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    http.expectOne(statusUrl(7)).flush({ status: 'error' });

    expect(message).toBe('Не удалось обработать файл');
    vi.useRealTimers();
  });

  it('errors when the storage upload returns a non 2xx status', () => {
    let message: string | undefined;

    service.upload(makeItem(), SESSION_ID).subscribe({ error: (err) => (message = err.message) });

    requestParams();
    const xhr = FakeXhr.last();
    xhr.status = 403;
    xhr.onload?.();

    expect(message).toBe('Не удалось загрузить файл в хранилище (403)');
  });

  it('errors when the storage request fails at the network level', () => {
    let message: string | undefined;

    service.upload(makeItem(), SESSION_ID).subscribe({ error: (err) => (message = err.message) });

    requestParams();
    FakeXhr.last().onerror?.();

    expect(message).toBe('Не удалось загрузить файл в хранилище');
  });

  it('errors when the upload params request fails', () => {
    let message: string | undefined;

    service.upload(makeItem(), SESSION_ID).subscribe({ error: (err) => (message = err.message) });

    http
      .expectOne(`${environment.apiUrl}/chats/${SESSION_ID}/uploads`)
      .flush({ detail: 'no session' }, { status: 404, statusText: 'Not Found' });

    expect(message).toBeTruthy();
  });

  it('errors when the confirm request fails', () => {
    let message: string | undefined;

    vi.useFakeTimers();
    service.upload(makeItem(), SESSION_ID).subscribe({ error: (err) => (message = err.message) });

    requestParams();
    const xhr = FakeXhr.last();
    xhr.status = 200;
    xhr.onload?.();
    http
      .expectOne(uploadUrl(7))
      .flush({ detail: 'broken' }, { status: 500, statusText: 'Server Error' });

    expect(message).toBeTruthy();
    vi.useRealTimers();
  });

  it('errors when the status polling exceeds the attempt limit', () => {
    let message: string | undefined;

    vi.useFakeTimers();
    service.upload(makeItem(), SESSION_ID).subscribe({ error: (err) => (message = err.message) });

    requestParams();
    const xhr = FakeXhr.last();
    xhr.status = 200;
    xhr.onload?.();
    http.expectOne(uploadUrl(7)).flush({ message: 'File uploaded' });

    for (let i = 0; i < 150; i++) {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
      http.expectOne(statusUrl(7)).flush({ status: 'uploading' });
    }

    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    http.verify();
    expect(message).toBe('Превышено время ожидания обработки файла');
    vi.useRealTimers();
  });

  it('aborts the request and cancels the timer on unsubscribe', () => {
    vi.useFakeTimers();
    const subscription = service.upload(makeItem(), SESSION_ID).subscribe();

    requestParams();
    const xhr = FakeXhr.last();
    xhr.status = 200;
    xhr.onload?.();
    http.expectOne(uploadUrl(7)).flush({ message: 'File uploaded' });
    vi.advanceTimersByTime(POLL_INTERVAL_MS);
    http.expectOne(statusUrl(7)).flush({ status: 'processing' });

    subscription.unsubscribe();

    expect(xhr.aborted).toBe(true);
    vi.advanceTimersByTime(POLL_INTERVAL_MS * 5);
    http.verify();
    vi.useRealTimers();
  });

  it('ignores the upload result after unsubscribing', () => {
    const values: number[] = [];

    const subscription = service.upload(makeItem(), SESSION_ID).subscribe((v) => values.push(v));
    requestParams();
    const xhr = FakeXhr.last();
    subscription.unsubscribe();

    xhr.status = 200;
    xhr.onload?.();
    xhr.upload.onprogress?.(progressEvent(100));

    expect(values).toEqual([]);
  });
});
