import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { ChatService } from './chat.service';
import { environment } from '../../../environments/environment';

const SESSION_ID = 'd0a3f1e2-0000-4000-8000-123456789abc';

describe('ChatService', () => {
  let service: ChatService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(ChatService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('creates a chat and returns the session id', () => {
    let result: { session_id: string } | undefined;

    service.create().subscribe((created) => {
      result = created;
    });

    const req = http.expectOne(`${environment.apiUrl}/chats/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ session_id: SESSION_ID }, { status: 202, statusText: 'Accepted' });

    expect(result?.session_id).toBe(SESSION_ID);
  });

  it('loads chat messages', () => {
    let result: unknown;

    service.messages(SESSION_ID).subscribe((messages) => {
      result = messages;
    });

    const req = http.expectOne(`${environment.apiUrl}/chats/${SESSION_ID}`);
    expect(req.request.method).toBe('GET');
    req.flush([
      {
        id: 1,
        role: 'user',
        content: 'Нужен расчёт фланца DN100',
        timestamp: '2026-09-12T12:18:35.689095Z'
      }
    ]);

    expect(result).toEqual([
      {
        id: 1,
        role: 'user',
        content: 'Нужен расчёт фланца DN100',
        timestamp: '2026-09-12T12:18:35.689095Z'
      }
    ]);
  });

  it('sends a message to the chat', () => {
    let result: { message: string } | undefined;

    service.send(SESSION_ID, 'Уточни толщину стенки').subscribe((response) => {
      result = response;
    });

    const req = http.expectOne(`${environment.apiUrl}/chats/${SESSION_ID}`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ content: 'Уточни толщину стенки' });
    req.flush({ message: 'Message accepted' }, { status: 202, statusText: 'Accepted' });

    expect(result?.message).toBe('Message accepted');
  });

  it('fetches the generation result', () => {
    let result: { running: boolean } | undefined;

    service.result(SESSION_ID).subscribe((chatResult) => {
      result = chatResult;
    });

    const req = http.expectOne(`${environment.apiUrl}/chats/${SESSION_ID}/result`);
    expect(req.request.method).toBe('GET');
    req.flush({ running: true, result: null });

    expect(result?.running).toBe(true);
  });

  it('performs the attachment upload pipeline requests', () => {
    const uploads: unknown[] = [];

    service
      .requestUpload(SESSION_ID, {
        content_type: 'application/pdf',
        file_size: 1024,
        filename: 'деталь.pdf'
      })
      .subscribe((params) => uploads.push(params));
    service.confirmUploaded(SESSION_ID, 7).subscribe((response) => uploads.push(response));
    service.attachmentStatus(SESSION_ID, 7).subscribe((response) => uploads.push(response));
    service.getAttachmentUrl(SESSION_ID, 7).subscribe((url) => uploads.push(url));

    const requestReq = http.expectOne(
      (r) => r.url === `${environment.apiUrl}/chats/${SESSION_ID}/uploads` && r.method === 'POST'
    );
    expect(requestReq.request.body).toEqual({
      content_type: 'application/pdf',
      file_size: 1024,
      filename: 'деталь.pdf'
    });
    requestReq.flush({
      attachment_id: 7,
      params: { url: 'https://minio/upload', fields: { key: 'attachments/1' } }
    });

    const uploadedReq = http.expectOne(
      (r) =>
        r.url === `${environment.apiUrl}/chats/${SESSION_ID}/uploads/7/uploaded` &&
        r.method === 'POST'
    );
    uploadedReq.flush({ message: 'File uploaded, processing started' });

    const statusReq = http.expectOne(
      (r) =>
        r.url === `${environment.apiUrl}/chats/${SESSION_ID}/uploads/7/status` &&
        r.method === 'POST'
    );
    statusReq.flush({ status: 'completed' });

    const urlReq = http.expectOne(
      (r) =>
        r.url === `${environment.apiUrl}/chats/${SESSION_ID}/attachments/7` && r.method === 'GET'
    );
    urlReq.flush({ attachment_url: 'https://minio/download', filename: 'kp.xlsx' });

    expect(uploads).toEqual([
      {
        attachment_id: 7,
        params: { url: 'https://minio/upload', fields: { key: 'attachments/1' } }
      },
      { message: 'File uploaded, processing started' },
      { status: 'completed' },
      { attachment_url: 'https://minio/download', filename: 'kp.xlsx' }
    ]);
  });

  it('removes the chat session', () => {
    let result: { deleted: boolean } | undefined;

    service.remove(SESSION_ID).subscribe((response) => {
      result = response;
    });

    const req = http.expectOne(`${environment.apiUrl}/chats/${SESSION_ID}`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ deleted: true });

    expect(result?.deleted).toBe(true);
  });

  it('retries the last generation', () => {
    let result: { message: string } | undefined;

    service.retry(SESSION_ID).subscribe((response) => {
      result = response;
    });

    const req = http.expectOne(`${environment.apiUrl}/chats/${SESSION_ID}/retry`);
    expect(req.request.method).toBe('POST');
    req.flush({ message: 'Retry accepted' }, { status: 202, statusText: 'Accepted' });

    expect(result?.message).toBe('Retry accepted');
  });
});
