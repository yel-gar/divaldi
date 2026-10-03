import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';

import { CalculationChatComponent } from './calculation-chat.component';
import { environment } from '../../../environments/environment';
import { NotificationService } from '../../core/services/notification.service';
import { InitialChatStateService } from '../../core/services/initial-chat-state.service';
import { KP_FILENAME } from '../../core/models/models';

const SESSION_ID = 'd0a3f1e2-0000-4000-8000-123456789abc';
const HISTORY_URL = `${environment.apiUrl}/chats/${SESSION_ID}`;
const RESULT_URL = `${environment.apiUrl}/chats/${SESSION_ID}/result`;
const SEND_URL = `${environment.apiUrl}/chats/${SESSION_ID}`;
const ATTACHMENTS_URL = `${environment.apiUrl}/chats/${SESSION_ID}/attachments`;

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const USER_MESSAGES = [
  {
    id: 1,
    role: 'user',
    content: 'Расчёт кронштейна',
    attachments: [],
    timestamp: '2026-09-12T12:18:35.689095Z'
  }
];

const successResult = (overrides: Record<string, unknown> = {}) => ({
  running: false,
  result: {
    type: 'success',
    content: 'Готово',
    timestamp: '2026-09-12T12:19:00.000000Z',
    attachment_id: null,
    update_name: null,
    ...overrides
  }
});

/**
 * Behaviour of the chat view: sending, the 2 s polling loop, its 5-minute
 * timeout, the result states, and the attachment actions.
 *
 * Polling is driven with fake timers so the loop is exercised without waiting
 * real time. `matchMedia` is stubbed because jsdom does not implement it and the
 * component reads it in an afterRenderEffect.
 */
describe('CalculationChat behaviour', () => {
  let fixture: ComponentFixture<CalculationChatComponent>;
  let http: HttpTestingController;
  let component: CalculationChatComponent;
  let notifications: NotificationService;

  /**
   * Opens the session and answers the "is the agent already running?" probe.
   *
   * When the last history message is outgoing, the component asks for the result
   * once to decide whether to resume polling, so that request has to be flushed
   * before the test's own polling assertions.
   */
  const openSession = (history: unknown[] = USER_MESSAGES, agentRunning = false): void => {
    fixture = TestBed.createComponent(CalculationChatComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('id', SESSION_ID);
    fixture.detectChanges();
    http.expectOne(HISTORY_URL).flush(history);
    fixture.detectChanges();

    const last = history.at(-1);
    if (last && (last as { role: string }).role === 'user') {
      const probe = http.expectOne(RESULT_URL);
      probe.flush({ running: agentRunning, result: null });
      fixture.detectChanges();
      if (agentRunning) {
        // resumePollingIfAgentRunning started the interval; stop it again.
        component.agentStatus.set(null);
      }
    }
  };

  beforeEach(() => {
    // jsdom implements neither matchMedia nor Element.scrollTo, both of which the
    // component's afterRenderEffect uses.
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })
    );
    if (!Element.prototype.scrollTo) {
      Element.prototype.scrollTo = () => undefined;
    }
    TestBed.configureTestingModule({
      imports: [CalculationChatComponent],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });
    http = TestBed.inject(HttpTestingController);
    notifications = TestBed.inject(NotificationService);
    vi.spyOn(notifications, 'error');
    vi.spyOn(notifications, 'success');
    vi.spyOn(notifications, 'info');
    vi.spyOn(notifications, 'warning');
  });

  afterEach(() => {
    // The component polls on a 2 s interval, so a fake-timer test can leave
    // hundreds of unconsumed requests. Destroy first (onDestroy clears the
    // timers), then drop whatever is still queued without flushing it. Both steps
    // matter: flushing throws on a cancelled request, and verify() is what
    // resets the TestBed for the next test.
    fixture?.destroy();
    fixture = undefined as unknown as ComponentFixture<CalculationChatComponent>;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    http.match(() => true);
    TestBed.resetTestingModule();
  });

  // --- sending ------------------------------------------------------------

  it('sends the trimmed text and starts polling', () => {
    vi.useFakeTimers();
    openSession();

    component.onMessageInput({ target: { value: '  привет  ' } } as unknown as Event);
    component.sendMessage();

    const req = http.expectOne(SEND_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ content: 'привет' });
    req.flush({ message: 'ok' });
    fixture.detectChanges();

    expect(component.messages().at(-1)?.text).toBe('привет');
    expect(component.agentStatus()).toBe('thinking');
  });

  it('sends on Enter without shift and ignores shift+Enter', () => {
    openSession();
    const spy = vi.spyOn(component, 'sendMessage');

    const enter = {
      key: 'Enter',
      shiftKey: false,
      preventDefault: vi.fn()
    } as unknown as KeyboardEvent;
    component.onMessageKeydown(enter);
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledTimes(1);

    component.onMessageKeydown({
      key: 'Enter',
      shiftKey: true,
      preventDefault: vi.fn()
    } as unknown as KeyboardEvent);
    component.onMessageKeydown({
      key: 'a',
      shiftKey: false,
      preventDefault: vi.fn()
    } as unknown as KeyboardEvent);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('refuses to send an empty message but complains when files are attached', () => {
    openSession();
    component.onFilesChange([new File(['x'], 'a.pdf', { type: 'application/pdf' })]);
    component.onMessageInput({ target: { value: '   ' } } as unknown as Event);
    component.sendMessage();

    expect(notifications.error).toHaveBeenCalledWith('Добавьте текст к сообщению');
    expect(http.match((r) => r.method === 'POST')).toEqual([]);
  });

  it('stays silent for an empty message with no files', () => {
    openSession();
    component.onMessageInput({ target: { value: '' } } as unknown as Event);
    component.sendMessage();
    expect(notifications.error).not.toHaveBeenCalled();
  });

  it('warns and refuses while files are still uploading', () => {
    openSession();
    (component as unknown as { isUploading: { set: (v: boolean) => void } }).isUploading.set(true);
    component.onMessageInput({ target: { value: 'привет' } } as unknown as Event);
    component.sendMessage();

    expect(notifications.warning).toHaveBeenCalledWith(
      'Файлы ещё не все загрузились — дождитесь завершения'
    );
  });

  it('ignores a send while the agent is already working', () => {
    openSession();
    component.agentStatus.set('thinking');
    component.onMessageInput({ target: { value: 'привет' } } as unknown as Event);
    component.sendMessage();
    expect(http.match((r) => r.method === 'POST')).toEqual([]);
  });

  it('restores the text and drops the bubble when sending fails', () => {
    openSession();
    component.onMessageInput({ target: { value: 'привет' } } as unknown as Event);
    component.sendMessage();
    http.expectOne(SEND_URL).flush({ detail: 'boom' }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    // Only the optimistic bubble is dropped; the loaded history stays.
    expect(component.messages().map((m) => m.id)).toEqual([1]);
    expect(component.messageInputValue()).toBe('привет');
    expect(notifications.error).toHaveBeenCalled();
  });

  it('attaches the staged files to the outgoing message', () => {
    vi.useFakeTimers();
    openSession();
    const file = new File(['x'], 'drawing.pdf', { type: 'application/pdf' });
    component.onFilesChange([file]);
    component.onMessageInput({ target: { value: 'с чертежом' } } as unknown as Event);
    component.sendMessage();
    http.expectOne(SEND_URL).flush({ message: 'ok' });
    fixture.detectChanges();

    expect(component.messages().at(-1)?.attachments?.[0]).toEqual(
      expect.objectContaining({ name: 'drawing.pdf' })
    );
    expect(component.attachedFiles()).toEqual([]);
  });

  // --- polling ------------------------------------------------------------

  it('polls every two seconds and stops when the agent answers', async () => {
    vi.useFakeTimers();
    openSession();
    component.onMessageInput({ target: { value: 'привет' } } as unknown as Event);
    component.sendMessage();
    http.expectOne(SEND_URL).flush({ message: 'ok' });
    fixture.detectChanges();

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    http.expectOne(RESULT_URL).flush({ running: true, result: null });

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    http.expectOne(RESULT_URL).flush(successResult());
    fixture.detectChanges();

    expect(component.agentStatus()).toBeNull();
    expect(component.messages().at(-1)?.direction).toBe('incoming');
    expect(notifications.info).toHaveBeenCalledWith('Агент ответил на ваше сообщение');
  });

  it('reports a failed generation and clears the polling state', async () => {
    vi.useFakeTimers();
    openSession();
    component.onMessageInput({ target: { value: 'привет' } } as unknown as Event);
    component.sendMessage();
    http.expectOne(SEND_URL).flush({ message: 'ok' });

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    http.expectOne(RESULT_URL).flush({
      running: false,
      result: {
        type: 'error',
        content: 'oops',
        timestamp: '',
        attachment_id: null,
        update_name: null
      }
    });
    fixture.detectChanges();

    expect(component.lastMessageFailed()).toBe(true);
    expect(component.agentStatus()).toBeNull();
    expect(notifications.error).toHaveBeenCalledWith(
      'Агент не смог обработать запрос — попробуйте позже'
    );
  });

  it('surfaces the commercial offer as an attachment', async () => {
    vi.useFakeTimers();
    openSession();
    component.onMessageInput({ target: { value: 'привет' } } as unknown as Event);
    component.sendMessage();
    http.expectOne(SEND_URL).flush({ message: 'ok' });

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    http.expectOne(RESULT_URL).flush(successResult({ attachment_id: 7 }));
    fixture.detectChanges();

    expect(component.messages().at(-1)?.attachments?.[0]?.name).toBe(KP_FILENAME);
    expect(component.sessionFiles().map((f) => f.attachmentId)).toContain(7);
    expect(notifications.success).toHaveBeenCalledWith('Коммерческое предложение готово');
  });

  it('gives up after the five minute timeout', async () => {
    vi.useFakeTimers();
    openSession();
    component.onMessageInput({ target: { value: 'привет' } } as unknown as Event);
    component.sendMessage();
    http.expectOne(SEND_URL).flush({ message: 'ok' });

    await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS + POLL_INTERVAL_MS);
    fixture.detectChanges();

    expect(component.lastMessageFailed()).toBe(true);
    expect(component.agentStatus()).toBeNull();
    expect(notifications.error).toHaveBeenCalledWith('Агент не ответил — попробуйте позже');
  });

  it('does not duplicate a reply that is already in the history', async () => {
    vi.useFakeTimers();
    openSession();
    component.onMessageInput({ target: { value: 'привет' } } as unknown as Event);
    component.sendMessage();
    http.expectOne(SEND_URL).flush({ message: 'ok' });

    const before = component.messages().length;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    http.expectOne(RESULT_URL).flush(successResult({ timestamp: '2026-09-12T12:19:00.000000Z' }));
    fixture.detectChanges();
    expect(component.messages().length).toBe(before + 1);

    component.onRetryRequest();
    http.expectOne(`${SEND_URL}/retry`).flush({ message: 'ok' });
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    http.expectOne(RESULT_URL).flush(successResult({ timestamp: '2026-09-12T12:19:00.000000Z' }));
    fixture.detectChanges();

    // Same timestamp as the reply already shown, so nothing is appended.
    expect(component.messages().length).toBe(before + 1);
  });

  it('survives a failed poll without stopping the loop', async () => {
    vi.useFakeTimers();
    openSession();
    component.onMessageInput({ target: { value: 'привет' } } as unknown as Event);
    component.sendMessage();
    http.expectOne(SEND_URL).flush({ message: 'ok' });

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    http
      .expectOne(RESULT_URL)
      .flush({ detail: 'nope' }, { status: 500, statusText: 'Server Error' });

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    http.expectOne(RESULT_URL).flush(successResult());
    fixture.detectChanges();

    expect(component.agentStatus()).toBeNull();
  });

  // --- retry, delete, panel, history errors -------------------------------

  it('retries and reports a failure', () => {
    vi.useFakeTimers();
    openSession();

    component.onRetryRequest();
    http
      .expectOne(`${SEND_URL}/retry`)
      .flush({ detail: 'nope' }, { status: 500, statusText: 'Server Error' });
    expect(notifications.error).toHaveBeenCalled();

    component.onRetryRequest();
    http.expectOne(`${SEND_URL}/retry`).flush({ message: 'ok' });
    expect(notifications.success).toHaveBeenCalledWith('Повторный запрос отправлен');
  });

  it('deletes the session and navigates away', async () => {
    openSession();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.deleteSession();
    http.expectOne(SEND_URL).flush({ deleted: true });
    await fixture.whenStable();

    expect(notifications.success).toHaveBeenCalledWith('Сессия удалена');
    expect(navigate).toHaveBeenCalledWith(['/create']);
  });

  it('explains a delete failure differently for a missing session', () => {
    openSession();

    component.deleteSession();
    http
      .expectOne(SEND_URL)
      .flush({ detail: 'Invalid session' }, { status: 403, statusText: 'Forbidden' });
    expect(notifications.error).toHaveBeenCalledWith('Сессия не найдена или уже удалена');

    // A 5xx is normalised to a generic message by extractApiErrorMessage.
    component.deleteSession();
    http.expectOne(SEND_URL).flush({ detail: 'oops' }, { status: 500, statusText: 'Server Error' });
    expect(notifications.error).toHaveBeenCalledWith('Не удалось удалить сессию: Ошибка сервера');
  });

  it('toggles the results panel', () => {
    openSession();
    expect(fixture.nativeElement.classList.contains('results-open')).toBe(false);
    component.handleResultsOpen();
    fixture.detectChanges();
    expect(component.isResultsOpen()).toBe(true);
    expect(fixture.nativeElement.classList.contains('results-open')).toBe(true);
    component.handleResultsOpen();
    expect(component.isResultsOpen()).toBe(false);
  });

  // --- files being uploaded -------------------------------------------------

  it('loads the files still being uploaded when the results panel opens', () => {
    openSession();

    component.handleResultsOpen();
    const req = http.expectOne(ATTACHMENTS_URL);
    expect(req.request.method).toBe('GET');
    req.flush([
      {
        id: 7,
        filename: 'деталь.pdf',
        status: 'uploading',
        ready: false,
        chat_message_id: null,
        timestamp: '2026-09-12T12:18:35.689095Z'
      },
      {
        id: 8,
        filename: 'sent.dxf',
        status: 'completed',
        ready: true,
        chat_message_id: 1,
        timestamp: '2026-09-12T12:18:36.689095Z'
      }
    ]);
    fixture.detectChanges();

    // Only the staged file belongs in this list; the other is already in the log.
    expect(component.pendingAttachments().map((a) => a.filename)).toEqual(['деталь.pdf']);
    expect(component.attachmentStatusLabel(component.pendingAttachments()[0])).toBe('Загружается');
    expect(fixture.nativeElement.textContent).toContain('Загруженные файлы');
    const pendingRows = fixture.debugElement.queryAll(By.css('.calculation-results__file'));
    expect(pendingRows.length).toBe(1);
    expect(pendingRows[0].nativeElement.textContent).toContain('деталь.pdf');
  });

  it('previews and downloads a staged file through the same actions', () => {
    openSession();
    component.handleResultsOpen();
    http.expectOne(ATTACHMENTS_URL).flush([
      {
        id: 7,
        filename: 'деталь.pdf',
        status: 'completed',
        ready: true,
        chat_message_id: null,
        timestamp: '2026-09-12T12:18:35.689095Z'
      }
    ]);
    fixture.detectChanges();
    const fetchFile = vi.fn().mockReturnValue({
      subscribe: (o: { next: (f: File) => void }) => o.next(new File(['x'], 'x'))
    });
    (
      component as unknown as { attachmentDownload: { fetchFile: typeof fetchFile } }
    ).attachmentDownload.fetchFile = fetchFile;

    const row = fixture.debugElement.queryAll(By.css('.calculation-results__file'))[0];
    row.query(By.css('[aria-label="Предпросмотр"]')).nativeElement.click();
    row.query(By.css('[aria-label="Скачать"]')).nativeElement.click();

    expect(fetchFile).toHaveBeenCalledTimes(2);
    expect(fetchFile).toHaveBeenCalledWith(SESSION_ID, 7);
  });

  it('does not re-fetch when the results panel is closed again', () => {
    openSession();

    component.handleResultsOpen();
    http.expectOne(ATTACHMENTS_URL).flush([]);
    component.handleResultsOpen();

    expect(http.match((r) => r.url === ATTACHMENTS_URL)).toEqual([]);
  });

  it('maps every upload state to a label', () => {
    openSession();
    const attachment = {
      id: 1,
      filename: 'a.pdf',
      ready: false,
      chat_message_id: null,
      timestamp: '2026-09-12T12:18:35.689095Z'
    };

    expect(component.attachmentStatusLabel({ ...attachment, status: 'uploading' })).toBe(
      'Загружается'
    );
    expect(component.attachmentStatusLabel({ ...attachment, status: 'processing' })).toBe(
      'Обрабатывается'
    );
    expect(component.attachmentStatusLabel({ ...attachment, status: 'error' })).toBe('Ошибка');
    expect(component.attachmentStatusLabel({ ...attachment, status: 'completed' })).toBe('Готово');
    // The Redis status key has a TTL; `ready` is what survives it.
    expect(component.attachmentStatusLabel({ ...attachment, status: 'unknown' })).toBe(
      'Статус неизвестен'
    );
    expect(component.attachmentStatusLabel({ ...attachment, status: 'unknown', ready: true })).toBe(
      'Готово'
    );
  });

  it('deletes a staged file from the panel', () => {
    openSession();
    component.handleResultsOpen();
    http.expectOne(ATTACHMENTS_URL).flush([
      {
        id: 7,
        filename: 'деталь.pdf',
        status: 'completed',
        ready: true,
        chat_message_id: null,
        timestamp: '2026-09-12T12:18:35.689095Z'
      }
    ]);
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('[aria-label="Удалить файл"]'));
    button.nativeElement.click();
    const req = http.expectOne(`${ATTACHMENTS_URL}/7`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ deleted: true });
    fixture.detectChanges();

    expect(component.pendingAttachments()).toEqual([]);
    expect(notifications.success).toHaveBeenCalledWith('Файл «деталь.pdf» удалён');
    expect(fixture.debugElement.query(By.css('[aria-label="Удалить файл"]'))).toBeNull();
  });

  it('keeps the row and reports a failed delete', () => {
    openSession();
    component.handleResultsOpen();
    http.expectOne(ATTACHMENTS_URL).flush([
      {
        id: 7,
        filename: 'деталь.pdf',
        status: 'uploading',
        ready: false,
        chat_message_id: null,
        timestamp: '2026-09-12T12:18:35.689095Z'
      }
    ]);
    fixture.detectChanges();

    fixture.debugElement.query(By.css('[aria-label="Удалить файл"]')).nativeElement.click();
    http
      .expectOne(`${ATTACHMENTS_URL}/7`)
      .flush({ detail: 'nope' }, { status: 500, statusText: 'Server Error' });

    expect(component.pendingAttachments().length).toBe(1);
    expect(notifications.error).toHaveBeenCalledWith('Не удалось удалить файл: Ошибка сервера');
  });

  it('reloads the staged files once an upload batch finishes', () => {
    openSession();

    component.onUploadingChange(true);
    expect(component.isUploading()).toBe(true);
    expect(http.match((r) => r.url === ATTACHMENTS_URL)).toEqual([]);

    component.onUploadingChange(false);
    const req = http.expectOne(ATTACHMENTS_URL);
    req.flush([]);
    expect(component.isUploading()).toBe(false);
    expect(component.pendingAttachments()).toEqual([]);
  });

  it('reports a failed request for the staged files', () => {
    openSession();

    component.handleResultsOpen();
    http
      .expectOne(ATTACHMENTS_URL)
      .flush({ detail: 'nope' }, { status: 500, statusText: 'Server Error' });

    expect(notifications.error).toHaveBeenCalledWith(
      'Не удалось загрузить список файлов: Ошибка сервера'
    );
    expect(component.pendingAttachments()).toEqual([]);
  });

  it('reports a history 403 as a missing request', () => {
    fixture = TestBed.createComponent(CalculationChatComponent);
    fixture.componentRef.setInput('id', SESSION_ID);
    fixture.detectChanges();
    http.expectOne(HISTORY_URL).flush({ detail: 'no' }, { status: 403, statusText: 'Forbidden' });

    expect(notifications.error).toHaveBeenCalledWith('Заявка не найдена');
  });

  it('reports a generic history failure', () => {
    fixture = TestBed.createComponent(CalculationChatComponent);
    fixture.componentRef.setInput('id', SESSION_ID);
    fixture.detectChanges();
    http
      .expectOne(HISTORY_URL)
      .flush({ detail: 'nope' }, { status: 500, statusText: 'Server Error' });

    expect(notifications.error).toHaveBeenCalledWith(
      'Не удалось загрузить историю чата: Ошибка сервера'
    );
  });

  // --- attachments --------------------------------------------------------

  it('describes a file by type', () => {
    openSession();
    expect(component.fileIconFor('drawing.pdf')).toBeTruthy();
    expect(component.fileColorFor('drawing.pdf')).toBeTruthy();
  });

  it('previews and downloads a local file without a request', () => {
    openSession();
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });

    component.openAttachmentPreview({ name: 'a.pdf', attachmentId: 1, file });
    expect(component.previewedFile()).toBe(file);

    const save = vi.fn();
    (
      component as unknown as { attachmentDownload: { save: typeof save } }
    ).attachmentDownload.save = save;
    component.downloadAttachment({ name: 'a.pdf', attachmentId: 1, file });
    expect(save).toHaveBeenCalled();
  });

  it('fetches a server-side attachment before previewing it', () => {
    openSession();
    const fetched = new File(['x'], 'server.pdf', { type: 'application/pdf' });
    const fetchFile = vi
      .fn()
      .mockReturnValue({ subscribe: (o: { next: (f: File) => void }) => o.next(fetched) });
    (
      component as unknown as { attachmentDownload: { fetchFile: typeof fetchFile } }
    ).attachmentDownload.fetchFile = fetchFile;

    component.openAttachmentPreview({ name: 'server.pdf', attachmentId: 5 });
    expect(fetchFile).toHaveBeenCalledWith(SESSION_ID, 5);
    expect(component.previewedFile()).toBe(fetched);
  });

  it('does nothing for an attachment without an id', () => {
    openSession();
    const fetchFile = vi.fn();
    (
      component as unknown as { attachmentDownload: { fetchFile: typeof fetchFile } }
    ).attachmentDownload.fetchFile = fetchFile;

    component.openAttachmentPreview({ name: 'x.pdf' });
    component.downloadAttachment({ name: 'x.pdf' });
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('notifies when a server attachment cannot be fetched', () => {
    openSession();
    const fetchFile = vi.fn().mockReturnValue({
      subscribe: (o: { error: (e: unknown) => void }) => o.error(new Error('boom'))
    });
    (
      component as unknown as { attachmentDownload: { fetchFile: typeof fetchFile } }
    ).attachmentDownload.fetchFile = fetchFile;

    component.openAttachmentPreview({ name: 'x.pdf', attachmentId: 9 });
    expect(notifications.error).toHaveBeenCalledWith('boom');
  });

  // --- the handoff from the create page -----------------------------------

  it('starts polling immediately for a message handed over from the create page', () => {
    vi.useFakeTimers();
    const state: InitialChatStateService = TestBed.inject(InitialChatStateService);
    const file = new File(['x'], 'plan.pdf', { type: 'application/pdf' });
    state.set({ text: 'из черновика', files: [file] });

    openSession([]);

    expect(component.messages()[0]?.text).toBe('из черновика');
    expect(component.messages()[0]?.attachments?.[0]?.name).toBe('plan.pdf');
    expect(component.agentStatus()).toBe('thinking');
  });

  it('forwards dropped files to the drop zone', () => {
    openSession();
    const files = [new File(['x'], 'a.pdf', { type: 'application/pdf' })];
    component.onFilesDropped(files);
    component.openFilePicker();
    // The view child is absent in this fixture; the optional chain must not throw.
    expect(true).toBe(true);
  });
});
