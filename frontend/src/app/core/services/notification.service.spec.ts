import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotificationService);
  });

  it('starts with an empty list', () => {
    expect(service.notifications()).toEqual([]);
  });

  it('adds a success notification', () => {
    service.success('Файл загружен');

    const list = service.notifications();
    expect(list.length).toBe(1);
    expect(list[0].type).toBe('success');
    expect(list[0].message).toBe('Файл загружен');
    expect(list[0].id).toBeTruthy();
  });

  it('adds an info and a warning notification', () => {
    service.info('Расчёт готов');
    expect(service.notifications()[0].type).toBe('info');

    service.warning('Проверьте размер');
    expect(service.notifications()[0].type).toBe('warning');
    expect(service.notifications()[0].message).toBe('Проверьте размер');
  });

  it('replaces the current notification instead of queueing', () => {
    service.success('Первый');
    const firstId = service.notifications()[0].id;

    service.error('Второй');

    expect(service.notifications().length).toBe(1);
    expect(service.notifications()[0].message).toBe('Второй');
    expect(service.notifications()[0].id).not.toBe(firstId);
  });

  it('removes a notification by id', () => {
    service.success('Файл загружен');
    const id = service.notifications()[0].id;

    service.remove(id);

    expect(service.notifications()).toEqual([]);
  });

  it('keeps the notification when the id is unknown', () => {
    service.success('Файл загружен');

    service.remove('missing-id');

    expect(service.notifications().length).toBe(1);
  });

  describe('errorOnce', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('emits the error only once inside the dedupe window', () => {
      service.errorOnce('Ошибка сервера');
      service.errorOnce('Ошибка сервера');
      service.errorOnce('Ошибка сервера');

      expect(service.notifications().length).toBe(1);
    });

    it('emits the error again after the window has passed', () => {
      service.errorOnce('Ошибка сервера');
      vi.advanceTimersByTime(3000);
      service.errorOnce('Ошибка сервера');

      expect(service.notifications().length).toBe(1);
      expect(service.notifications()[0].message).toBe('Ошибка сервера');
    });

    it('never dedupes a different message', () => {
      service.errorOnce('Ошибка сервера');
      service.errorOnce('Проверьте поля');

      expect(service.notifications()[0].message).toBe('Проверьте поля');
    });

    it('respects a custom dedupe window', () => {
      service.errorOnce('Ошибка сервера', 1000);
      vi.advanceTimersByTime(1500);
      service.errorOnce('Ошибка сервера');

      expect(service.notifications().length).toBe(1);
    });
  });
});
