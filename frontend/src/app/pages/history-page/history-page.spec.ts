import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { HistoryPage } from './history-page.component';
import { environment } from '../../../environments/environment';

const SESSIONS = [
  {
    session_id: 'bbbbbbbb-0000-4000-8000-000000000000',
    last_message: { id: 1, role: 'assistant', content: 'Latest', timestamp: '2025-06-01T12:00:00Z' }
  },
  {
    session_id: 'aaaaaaaa-0000-4000-8000-000000000000',
    last_message: { id: 2, role: 'user', content: 'Older', timestamp: '2025-05-26T12:00:00Z' }
  }
];

describe('HistoryPage', () => {
  let fixture: ComponentFixture<HistoryPage>;
  let http: HttpTestingController;

  const rows = () => fixture.debugElement.queryAll(By.css('tbody tr'));
  const sortButtons = () => fixture.debugElement.queryAll(By.css('th.sortable > .th-content'));
  const headers = () => fixture.debugElement.queryAll(By.css('th.sortable'));

  const createWithSessions = (response: object): void => {
    fixture = TestBed.createComponent(HistoryPage);
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/chats/`).flush(response);
    fixture.detectChanges();
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

  it('renders sessions from the API sorted by date descending by default', () => {
    createWithSessions(SESSIONS);

    expect(rows().length).toBe(2);
    expect(rows()[0].nativeElement.textContent).toContain('bbbbbbbb');
    expect(rows()[0].nativeElement.textContent).toContain('01.06.2025');
    expect(rows()[1].nativeElement.textContent).toContain('aaaaaaaa');
  });

  it('toggles sorting between directions when a header is clicked', () => {
    createWithSessions(SESSIONS);

    sortButtons()[0].nativeElement.click();
    fixture.detectChanges();
    expect(rows()[0].nativeElement.textContent).toContain('aaaaaaaa');

    sortButtons()[0].nativeElement.click();
    fixture.detectChanges();
    expect(rows()[0].nativeElement.textContent).toContain('bbbbbbbb');
  });

  it('exposes aria-sort on sortable headers', () => {
    createWithSessions(SESSIONS);

    expect(headers()[0].nativeElement.getAttribute('aria-sort')).toBe('none');
    expect(headers()[1].nativeElement.getAttribute('aria-sort')).toBe('descending');

    sortButtons()[0].nativeElement.click();
    fixture.detectChanges();
    expect(headers()[0].nativeElement.getAttribute('aria-sort')).toBe('ascending');
    expect(headers()[1].nativeElement.getAttribute('aria-sort')).toBe('none');
  });

  it('shows a spinner while loading', () => {
    fixture = TestBed.createComponent(HistoryPage);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('app-spinner'))).not.toBeNull();

    http.expectOne(`${environment.apiUrl}/chats/`).flush(SESSIONS);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('app-spinner'))).toBeNull();
  });

  it('shows an empty state when there are no sessions', () => {
    createWithSessions([]);

    expect(fixture.debugElement.query(By.css('tbody'))).toBeNull();
    expect(
      fixture.debugElement.query(By.css('.history-state--empty')).nativeElement.textContent
    ).toContain('Пока нет заявок');
  });
});
