import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { HistoryPage } from './history-page.component';
import { CHATS_PAGE_SIZE } from '../../core/services/chat.service';
import { environment } from '../../../environments/environment';

const SESSIONS = [
  {
    session_id: 'bbbbbbbb-0000-4000-8000-000000000000',
    last_message: {
      id: 1,
      role: 'assistant',
      content: 'Latest',
      timestamp: '2025-06-01T12:00:00Z'
    },
    name: 'Расчёт КП'
  },
  {
    session_id: 'aaaaaaaa-0000-4000-8000-000000000000',
    last_message: { id: 2, role: 'user', content: 'Older', timestamp: '2025-05-26T12:00:00Z' },
    name: 'Заявка на поставку'
  }
];

describe('HistoryPage', () => {
  let fixture: ComponentFixture<HistoryPage>;
  let http: HttpTestingController;

  const rows = () => fixture.debugElement.queryAll(By.css('tbody tr'));
  const sortButtons = () => fixture.debugElement.queryAll(By.css('th.sortable > .th-content'));
  const headers = () => fixture.debugElement.queryAll(By.css('th.sortable'));
  const pagination = () => fixture.debugElement.query(By.css('.pagination'));
  const paginationButtons = () => fixture.debugElement.queryAll(By.css('.pagination__button'));
  const pageStatus = () => fixture.debugElement.query(By.css('.pagination__status'));

  const chatsRequest = () =>
    http.expectOne((r) => r.url === `${environment.apiUrl}/chats/` && r.method === 'GET');

  const create = (): void => {
    fixture = TestBed.createComponent(HistoryPage);
    fixture.detectChanges();
  };

  const flushPage = (
    items: object[],
    total = items.length,
    page = 0,
    itemsPerPage = CHATS_PAGE_SIZE
  ): void => {
    chatsRequest().flush({ items, total, page, items_per_page: itemsPerPage });
    fixture.detectChanges();
  };

  const createWithSessions = (items: object[], total?: number): void => {
    create();
    flushPage(items, total);
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HistoryPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()]
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('asks for the first page ordered by the most recent activity', () => {
    create();

    const req = chatsRequest();
    expect(req.request.params.get('page')).toBe('0');
    expect(req.request.params.get('items_per_page')).toBe(String(CHATS_PAGE_SIZE));
    expect(req.request.params.get('sort')).toBe('date');
    expect(req.request.params.get('order')).toBe('desc');
    req.flush({ items: SESSIONS, total: 2, page: 0, items_per_page: CHATS_PAGE_SIZE });
    fixture.detectChanges();

    expect(rows().length).toBe(2);
  });

  it('renders the page the server returned, in the order the server sent it', () => {
    createWithSessions(SESSIONS);

    expect(rows().length).toBe(2);
    expect(rows()[0].nativeElement.textContent).toContain('bbbbbbbb');
    expect(rows()[0].nativeElement.textContent).toContain('01.06.2025');
    expect(rows()[1].nativeElement.textContent).toContain('aaaaaaaa');
  });

  it('renders the last message of each session in a separate column', () => {
    createWithSessions(SESSIONS);

    const messageCells = () => fixture.debugElement.queryAll(By.css('td .history-message'));
    expect(messageCells().length).toBe(2);
    expect(messageCells()[0].nativeElement.textContent).toContain('Latest');
    expect(messageCells()[1].nativeElement.textContent).toContain('Older');
  });

  it('re-requests from the server with the toggled sort key', () => {
    createWithSessions(SESSIONS);

    sortButtons()[0].nativeElement.click();
    fixture.detectChanges();

    const req = chatsRequest();
    expect(req.request.params.get('sort')).toBe('number');
    expect(req.request.params.get('order')).toBe('asc');
    req.flush({
      items: [SESSIONS[1], SESSIONS[0]],
      total: 2,
      page: 0,
      items_per_page: CHATS_PAGE_SIZE
    });
    fixture.detectChanges();

    expect(rows()[0].nativeElement.textContent).toContain('aaaaaaaa');
  });

  it('reverses the direction when the same column is clicked again', () => {
    createWithSessions(SESSIONS);

    sortButtons()[1].nativeElement.click();
    fixture.detectChanges();
    chatsRequest().flush({ items: SESSIONS, total: 2, page: 0, items_per_page: CHATS_PAGE_SIZE });
    fixture.detectChanges();

    sortButtons()[1].nativeElement.click();
    fixture.detectChanges();

    const req = chatsRequest();
    expect(req.request.params.get('sort')).toBe('date');
    expect(req.request.params.get('order')).toBe('desc');
    req.flush({ items: SESSIONS, total: 2, page: 0, items_per_page: CHATS_PAGE_SIZE });
    fixture.detectChanges();
  });

  it('exposes aria-sort on sortable headers', () => {
    createWithSessions(SESSIONS);

    expect(headers()[0].nativeElement.getAttribute('aria-sort')).toBe('none');
    expect(headers()[1].nativeElement.getAttribute('aria-sort')).toBe('descending');

    sortButtons()[0].nativeElement.click();
    fixture.detectChanges();
    expect(headers()[0].nativeElement.getAttribute('aria-sort')).toBe('ascending');
    expect(headers()[1].nativeElement.getAttribute('aria-sort')).toBe('none');

    chatsRequest().flush({ items: SESSIONS, total: 2, page: 0, items_per_page: CHATS_PAGE_SIZE });
    fixture.detectChanges();
  });

  it('shows a skeleton while loading', () => {
    create();

    expect(fixture.debugElement.query(By.css('app-skeleton-users-table'))).not.toBeNull();

    flushPage(SESSIONS);

    expect(fixture.debugElement.query(By.css('app-skeleton-users-table'))).toBeNull();
  });

  it('shows an empty state when there are no sessions', () => {
    createWithSessions([]);

    expect(fixture.debugElement.query(By.css('tbody'))).toBeNull();
    expect(
      fixture.debugElement.query(By.css('.history-state--empty')).nativeElement.textContent
    ).toContain('Пока нет заявок');
  });

  it('hides the pager when everything fits on one page', () => {
    createWithSessions(SESSIONS, 2);

    expect(pagination()).toBeNull();
  });

  it('walks forward and back through pages', () => {
    createWithSessions(SESSIONS, CHATS_PAGE_SIZE + 1);

    expect(pageStatus().nativeElement.textContent).toContain('Страница 1 из 2');
    expect(paginationButtons()[0].nativeElement.disabled).toBe(true);
    expect(paginationButtons()[1].nativeElement.disabled).toBe(false);

    paginationButtons()[1].nativeElement.click();
    fixture.detectChanges();

    const forward = chatsRequest();
    expect(forward.request.params.get('page')).toBe('1');
    forward.flush({
      items: [SESSIONS[0]],
      total: CHATS_PAGE_SIZE + 1,
      page: 1,
      items_per_page: CHATS_PAGE_SIZE
    });
    fixture.detectChanges();

    expect(rows().length).toBe(1);
    expect(pageStatus().nativeElement.textContent).toContain('Страница 2 из 2');
    expect(paginationButtons()[0].nativeElement.disabled).toBe(false);
    expect(paginationButtons()[1].nativeElement.disabled).toBe(true);

    paginationButtons()[0].nativeElement.click();
    fixture.detectChanges();

    const backward = chatsRequest();
    expect(backward.request.params.get('page')).toBe('0');
    backward.flush({
      items: SESSIONS,
      total: CHATS_PAGE_SIZE + 1,
      page: 0,
      items_per_page: CHATS_PAGE_SIZE
    });
    fixture.detectChanges();

    expect(rows().length).toBe(2);
  });

  it('returns to the first page when the sort order changes', () => {
    createWithSessions(SESSIONS, CHATS_PAGE_SIZE + 1);

    paginationButtons()[1].nativeElement.click();
    fixture.detectChanges();
    chatsRequest().flush({
      items: [SESSIONS[0]],
      total: CHATS_PAGE_SIZE + 1,
      page: 1,
      items_per_page: CHATS_PAGE_SIZE
    });
    fixture.detectChanges();

    sortButtons()[0].nativeElement.click();
    fixture.detectChanges();

    const req = chatsRequest();
    expect(req.request.params.get('page')).toBe('0');
    expect(req.request.params.get('sort')).toBe('number');
    req.flush({ items: SESSIONS, total: 2, page: 0, items_per_page: CHATS_PAGE_SIZE });
    fixture.detectChanges();

    // Two sessions no longer span a second page, so the pager disappears entirely.
    expect(pagination()).toBeNull();
  });

  it('resets the pager when a page request fails', () => {
    createWithSessions(SESSIONS, CHATS_PAGE_SIZE + 1);

    paginationButtons()[1].nativeElement.click();
    fixture.detectChanges();
    chatsRequest().flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();

    expect(pagination()).toBeNull();
    expect(fixture.debugElement.query(By.css('.history-state--empty'))).not.toBeNull();
  });

  it('ignores a slow page response that arrives after a newer one', () => {
    createWithSessions(SESSIONS, CHATS_PAGE_SIZE + 1);

    paginationButtons()[1].nativeElement.click();
    fixture.detectChanges();
    const pageRequest = chatsRequest();
    // A sort click while that request is still in flight makes a second, newer one.
    sortButtons()[0].nativeElement.click();
    fixture.detectChanges();
    const sortRequest = chatsRequest();

    sortRequest.flush({
      items: [SESSIONS[1], SESSIONS[0]],
      total: CHATS_PAGE_SIZE + 1,
      page: 0,
      items_per_page: CHATS_PAGE_SIZE
    });
    pageRequest.flush({
      items: [SESSIONS[0]],
      total: CHATS_PAGE_SIZE + 1,
      page: 1,
      items_per_page: CHATS_PAGE_SIZE
    });
    fixture.detectChanges();

    expect(rows()[0].nativeElement.textContent).toContain('aaaaaaaa');
    expect(pageStatus().nativeElement.textContent).toContain('Страница 1 из 2');
  });
});
