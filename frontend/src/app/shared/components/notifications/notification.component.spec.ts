import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { Notification, NotificationType } from './notification.component';

const CASES: NotificationType[] = ['success', 'error', 'info', 'warning'];

describe('Notification', () => {
  let fixture: ComponentFixture<Notification>;

  const host = () => fixture.debugElement.nativeElement as HTMLElement;

  const create = (type: NotificationType, dismissible = false): void => {
    fixture = TestBed.createComponent(Notification);
    fixture.componentRef.setInput('type', type);
    fixture.componentRef.setInput('title', 'Файл загружен');
    if (dismissible) {
      fixture.componentRef.setInput('dismissible', true);
    }
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Notification] }).compileComponents();
  });

  it('renders the title and exposes status semantics', () => {
    create('success');

    expect(host().getAttribute('role')).toBe('status');
    expect(host().getAttribute('aria-live')).toBe('polite');
    expect(host().getAttribute('data-type')).toBe('success');
    expect(host().textContent).toContain('Файл загружен');
  });

  it.each(CASES)('renders an icon for the %s type', (type) => {
    create(type);

    expect(host().querySelectorAll('.notification__icon svg').length).toBe(1);
  });

  it('renders the description only when it is provided', () => {
    create('info');
    expect(host().querySelector('.notification__description')).toBeNull();

    fixture.componentRef.setInput('description', 'КП готово к скачиванию');
    fixture.detectChanges();

    expect(host().querySelector('.notification__description')?.textContent?.trim()).toBe(
      'КП готово к скачиванию'
    );
  });

  it('shows the close button only when dismissible', () => {
    create('error');
    expect(fixture.debugElement.query(By.css('.notification__close'))).toBeNull();

    fixture.componentRef.setInput('dismissible', true);
    fixture.detectChanges();

    const close = fixture.debugElement.query(By.css('.notification__close'));
    expect(close).not.toBeNull();
    expect(close.nativeElement.getAttribute('aria-label')).toBe('Закрыть уведомление');
  });

  it('emits closed when the close button is clicked', () => {
    create('warning', true);

    let closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    fixture.debugElement.query(By.css('.notification__close')).nativeElement.click();

    expect(closed).toBe(1);
  });

  it('reflects the leaving state as a modifier class', () => {
    create('info');
    expect(host().classList.contains('notification--leaving')).toBe(false);

    fixture.componentRef.setInput('leaving', true);
    fixture.detectChanges();

    expect(host().classList.contains('notification--leaving')).toBe(true);
  });
});
