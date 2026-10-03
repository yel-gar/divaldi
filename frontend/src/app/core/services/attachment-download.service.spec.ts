import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { AttachmentDownloadService } from './attachment-download.service';
import { environment } from '../../../environments/environment';

const SESSION_ID = 'd0a3f1e2-0000-4000-8000-123456789abc';

describe('AttachmentDownloadService', () => {
  let service: AttachmentDownloadService;
  let http: HttpTestingController;
  let fetchMock: ReturnType<typeof vi.fn>;

  const url = `${environment.apiUrl}/chats/${SESSION_ID}/attachments/7`;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(AttachmentDownloadService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
  });

  it('fetches the attachment and returns a File named after it', async () => {
    const blob = new Blob(['данные'], { type: 'application/pdf' });
    fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });

    const promise = new Promise<File>((resolve, reject) => {
      service.fetchFile(SESSION_ID, 7).subscribe({ next: resolve, error: reject });
    });

    const req = http.expectOne(url);
    expect(req.request.method).toBe('GET');
    req.flush({ attachment_url: 'https://minio/download/kp.pdf', filename: 'kp.pdf' });

    const file = await promise;

    expect(fetchMock).toHaveBeenCalledWith('https://minio/download/kp.pdf', { cache: 'no-store' });
    expect(file.name).toBe('kp.pdf');
    expect(file.size).toBe(blob.size);
  });

  it('errors when the storage responds with a failure status', async () => {
    fetchMock.mockResolvedValue({ ok: false, blob: () => Promise.resolve(new Blob([])) });

    const promise = new Promise<Error>((resolve) => {
      service.fetchFile(SESSION_ID, 7).subscribe({ error: resolve });
    });

    http
      .expectOne(url)
      .flush({ attachment_url: 'https://minio/download/kp.pdf', filename: 'kp.pdf' });

    const error = await promise;
    expect(error.message).toBe('Ссылка на файл недоступна — попробуйте ещё раз');
  });

  it('errors when the attachment url request fails', async () => {
    const promise = new Promise<HttpErrorResponse>((resolve) => {
      service.fetchFile(SESSION_ID, 7).subscribe({ error: resolve });
    });

    http.expectOne(url).flush({ detail: 'not found' }, { status: 404, statusText: 'Not Found' });

    expect((await promise).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saves the file through an anchor click and revokes the object url', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:https://app/attachment');
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const file = new File(['данные'], 'kp.pdf');
    service.save(file, 'kp.pdf');

    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(click).toHaveBeenCalledTimes(1);

    await new Promise((resolve) => setTimeout(resolve));
    expect(revoke).toHaveBeenCalledWith('blob:https://app/attachment');
  });
});
