import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router, Routes } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { OrderCreateComponent } from './order-create.component';
import { NotificationsComponent } from '../../shared/components/notifications/notifications.component';
import { AttachmentUploadService } from '../../core/services/attachment-upload.service';
import { InitialChatStateService } from '../../core/services/initial-chat-state.service';
import { UploadItem } from '../../core/models/models';
import { environment } from '../../../environments/environment';

const CHATS_URL = `${environment.apiUrl}/chats/`;

@Component({ selector: 'app-blank', template: '' })
class BlankComponent {}

const TEST_ROUTES: Routes = [{ path: 'chats/:id', component: BlankComponent }];

@Component({
  selector: 'app-order-create-test-host',
  imports: [OrderCreateComponent, NotificationsComponent],
  template: `<app-notifications /><app-order-create />`
})
class TestHost {}

class FakeUploader {
  readonly items: UploadItem[] = [];
  readonly sessionIds: string[] = [];
  failure: Error | null = null;

  upload(item: UploadItem, sessionId: string): Observable<number> {
    this.items.push(item);
    this.sessionIds.push(sessionId);
    if (this.failure) {
      return throwError(() => this.failure);
    }
    return of(item.size);
  }
}

function makeFile(name: string, size: number): File {
  return new File(['x'.repeat(size)], name, { type: 'application/octet-stream' });
}

function dropEvent(files: File[]): DragEvent {
  const event = new Event('drop', { bubbles: true }) as unknown as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: { files } as unknown as DataTransfer });
  return event;
}

describe('OrderCreateComponent', () => {
  let fixture: ComponentFixture<TestHost>;
  let uploader: FakeUploader;
  let initialChatState: InitialChatStateService;
  let router: Router;
  let http: HttpTestingController;

  const page = () =>
    fixture.debugElement.query(By.directive(OrderCreateComponent))
      .componentInstance as OrderCreateComponent;
  const descriptionField = () =>
    fixture.debugElement.query(By.css('#description')).nativeElement as HTMLTextAreaElement;
  const counter = () => fixture.debugElement.query(By.css('.textarea__counter'));
  const submitButton = () =>
    fixture.debugElement.query(By.css('button[type="submit"]')).nativeElement as HTMLButtonElement;
  const dropzone = () => fixture.debugElement.query(By.css('.dropzone__area'));
  const notificationText = () =>
    fixture.debugElement.query(By.css('.notification__title'))?.nativeElement.textContent ?? '';

  const refresh = (): void => fixture.detectChanges();

  const createPage = (): void => {
    fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
  };

  const describeTask = (description: string): void => {
    const field = descriptionField();
    field.value = description;
    field.dispatchEvent(new Event('input'));
    refresh();
  };

  const submitForm = (): void => {
    fixture.debugElement.query(By.css('form')).triggerEventHandler('submit', new Event('submit'));
    refresh();
  };

  const dropFiles = (files: File[]): void => {
    dropzone().nativeElement.dispatchEvent(dropEvent(files));
    refresh();
  };

  const createChat = (sessionId: string): void => {
    http.expectOne(CHATS_URL).flush({ session_id: sessionId });
  };

  beforeEach(async () => {
    uploader = new FakeUploader();
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [
        provideRouter(TEST_ROUTES),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AttachmentUploadService, useValue: uploader }
      ]
    }).compileComponents();

    router = TestBed.inject(Router);
    http = TestBed.inject(HttpTestingController);
    initialChatState = TestBed.inject(InitialChatStateService);
  });

  afterEach(() => {
    http.verify();
  });

  it('renders the order form with its heading and submit button', () => {
    createPage();

    expect(fixture.nativeElement.textContent).toContain('Создать заявку');
    expect(fixture.nativeElement.textContent).toContain('Опишите, что нужно рассчитать');
    expect(descriptionField().placeholder).toBe(
      'Нужно рассчитать резервуар объёмом 10 куб. м. для воды...'
    );
    expect(submitButton().textContent).toContain('Создать заявку и перейти в чат');
    expect(page().selectedFiles()).toEqual([]);
    expect(page().MAX_SYMBOLS).toBe(5000);
    expect(page().COUNTER_VISIBLE_FROM).toBe(1000);
  });

  it('hides the character counter until the threshold is reached', () => {
    createPage();
    expect(counter()).toBeNull();

    describeTask('я'.repeat(999));
    expect(counter()).toBeNull();

    describeTask('я'.repeat(1000));
    expect(counter().nativeElement.textContent.trim()).toBe('1000/5000');
  });

  it('keeps the selected files in the attachment list after a drop', () => {
    createPage();
    const file = makeFile('чертеж.dxf', 2048);

    dropFiles([file]);

    expect(page().selectedFiles()).toEqual([file]);
  });

  it('rejects an empty description and sends nothing', () => {
    createPage();
    submitForm();

    expect(notificationText()).toBe('Заполните все поля заявки');
    expect(page().orderForm.controls.description.touched).toBe(true);
    http.expectNone(CHATS_URL);
  });

  it('treats a whitespace-only description as empty', () => {
    createPage();
    describeTask('   ');
    submitForm();

    expect(notificationText()).toBe('Заполните все поля заявки');
    http.expectNone(CHATS_URL);
  });

  it('creates a chat, hands the message over and navigates into it', async () => {
    createPage();
    describeTask('  Нужен резервуар объёмом 10 куб. м.  ');
    submitForm();

    const createReq = http.expectOne(CHATS_URL);
    expect(createReq.request.method).toBe('POST');
    expect(createReq.request.body).toEqual({});
    createReq.flush({ session_id: 'sess-1' });

    const sendReq = http.expectOne(`${CHATS_URL}sess-1`);
    expect(sendReq.request.method).toBe('POST');
    expect(sendReq.request.body).toEqual({ content: 'Нужен резервуар объёмом 10 куб. м.' });

    sendReq.flush({ message: 'ok' });
    await fixture.whenStable();
    refresh();

    expect(router.url).toBe('/chats/sess-1');
    expect(notificationText()).toBe('Новый чат создан');
    expect(initialChatState.consume()).toEqual({
      text: 'Нужен резервуар объёмом 10 куб. м.',
      files: []
    });
    expect(page().orderForm.controls.description.value).toBe('');
    expect(submitButton().disabled).toBe(false);
  });

  it('disables the submit button while the chat is being created', async () => {
    createPage();
    describeTask('Нужен резервуар');
    submitForm();

    const createReq = http.expectOne(CHATS_URL);
    expect(submitButton().disabled).toBe(true);
    expect(page().isSubmitting()).toBe(true);

    createReq.flush({ session_id: 'sess-2' });
    http.expectOne(`${CHATS_URL}sess-2`).flush({ message: 'ok' });
    await fixture.whenStable();
    refresh();

    expect(submitButton().disabled).toBe(false);
    expect(page().isSubmitting()).toBe(false);
  });

  it('ignores a repeated submit while the first one is in flight', () => {
    createPage();
    describeTask('Нужен резервуар');
    submitForm();
    http.expectOne(CHATS_URL);

    page().onSubmit();

    http.expectNone(CHATS_URL);
  });

  it('uploads the dropped files before sending the message', async () => {
    createPage();
    const file = makeFile('чертеж.dxf', 2048);
    dropFiles([file]);
    describeTask('Нужен резервуар');
    submitForm();

    createChat('sess-3');
    expect(uploader.items).toHaveLength(1);
    expect(uploader.items[0].name).toBe('чертеж.dxf');
    expect(uploader.items[0].extension).toBe('.dxf');
    expect(uploader.items[0].size).toBe(2048);
    expect(uploader.items[0].status).toBe('queued');
    expect(uploader.items[0].uploaded).toBe(0);
    expect(uploader.sessionIds).toEqual(['sess-3']);

    http.expectOne(`${CHATS_URL}sess-3`).flush({ message: 'ok' });
    await fixture.whenStable();

    expect(initialChatState.consume()?.files).toEqual([file]);
  });

  it('reports a server failure and stays on the page', async () => {
    createPage();
    describeTask('Нужен резервуар');
    submitForm();

    http.expectOne(CHATS_URL).flush(null, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    refresh();

    expect(notificationText()).toBe('Не удалось создать заявку: Ошибка сервера');
    expect(router.url).not.toContain('/chats/');
    expect(submitButton().disabled).toBe(false);
  });

  it('reports the API detail when the chat cannot be created', async () => {
    createPage();
    describeTask('Нужен резервуар');
    submitForm();

    http
      .expectOne(CHATS_URL)
      .flush({ detail: 'Лимит заявок исчерпан' }, { status: 429, statusText: 'Too Many Requests' });
    await fixture.whenStable();
    refresh();

    expect(notificationText()).toBe('Не удалось создать заявку: Лимит заявок исчерпан');
  });

  it('reports a file upload failure and does not send the message', async () => {
    createPage();
    uploader.failure = new Error('Не удалось обработать файл');
    dropFiles([makeFile('схема.png', 512)]);
    describeTask('Нужен резервуар');
    submitForm();

    createChat('sess-4');
    await fixture.whenStable();
    refresh();

    expect(notificationText()).toBe('Не удалось создать заявку: Не удалось обработать файл');
    expect(router.url).not.toContain('/chats/');
    http.expectNone(`${CHATS_URL}sess-4`);
  });
});
