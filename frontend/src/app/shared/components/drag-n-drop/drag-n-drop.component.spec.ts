import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { Observable } from 'rxjs';

import { DragNDropComponent } from './drag-n-drop.component';
import {
  UPLOAD_SIMULATOR_TIMING,
  UploadSimulatorService,
  UploadSimulatorOptions
} from '../../../core/services/upload-simulator.service';
import { UploadItem } from '../../../core/models/models';

const MB = 1024 * 1024;

function makeFile(name: string, size: number): File {
  return new File(['x'.repeat(size)], name, { type: 'application/octet-stream' });
}

function dataTransferWith(files: File[]): DataTransfer {
  return { files } as unknown as DataTransfer;
}

function dragEvent(type: string, files: File[] = []): DragEvent {
  const event = new Event(type, { bubbles: true }) as unknown as DragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransferWith(files) });
  return event;
}

let itemSeq = 0;

function makeItem(overrides: Partial<UploadItem> = {}): UploadItem {
  return {
    id: 'id-' + ++itemSeq,
    name: 'file.pdf',
    size: MB,
    extension: '.pdf',
    file: makeFile('file.pdf', MB),
    status: 'queued',
    uploaded: 0,
    ...overrides
  };
}

@Component({
  selector: 'app-dnd-test-host',
  imports: [DragNDropComponent],
  template: `<app-drag-n-drop />`
})
class TestHost {}

describe('UploadSimulatorService', () => {
  let simulator: UploadSimulatorService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: UPLOAD_SIMULATOR_TIMING, useValue: FAST_TIMING }]
    });
    simulator = TestBed.inject(UploadSimulatorService);
  });

  it('emits growing uploaded byte counts and completes at the item size', async () => {
    const item = makeItem({ size: MB });
    const emissions: number[] = [];
    await new Promise<number>((resolve) => {
      simulator.upload(item, { onProgress: (uploaded) => emissions.push(uploaded) }).subscribe({
        complete: () => resolve(item.size),
        error: () => resolve(-1)
      });
    });

    expect(emissions.length).toBeGreaterThan(0);
    expect(emissions[emissions.length - 1]).toBe(item.size);
    expect(item.uploaded).toBe(0);
  });

  it('stops emitting after unsubscribe', async () => {
    const item = makeItem({ size: 10 * MB });
    const emissions: number[] = [];
    const sub = simulator
      .upload(item, { onProgress: (uploaded) => emissions.push(uploaded) })
      .subscribe();
    sub.unsubscribe();

    const countAtUnsub = emissions.length;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(emissions.length).toBe(countAtUnsub);
  });
});

const FAST_TIMING = { minChunkMs: 5, maxChunkMs: 10 };

describe('DragNDropComponent', () => {
  let fixture: ComponentFixture<TestHost>;
  let component: DragNDropComponent;

  const getDropzone = () => fixture.debugElement.query(By.css('.dropzone__area'));
  const getUploadItem = () => fixture.debugElement.queryAll(By.css('.upload-item'));

  function dropFiles(files: File[]): void {
    getDropzone().nativeElement.dispatchEvent(dragEvent('drop', files));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [{ provide: UPLOAD_SIMULATOR_TIMING, useValue: FAST_TIMING }]
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    component = fixture.debugElement.query(By.directive(DragNDropComponent))
      .componentInstance as DragNDropComponent;
  });

  it('starts in idle state and shows the dropzone', () => {
    expect(component.state()).toBe('idle');
    expect(getDropzone()).not.toBeNull();
    expect(fixture.debugElement.query(By.css('.uploader'))).toBeNull();
  });

  it('highlights the zone on dragover and resets on drop', () => {
    const zone = getDropzone().nativeElement;
    zone.dispatchEvent(dragEvent('dragover'));
    fixture.detectChanges();
    expect(component.isDragOver()).toBe(true);

    zone.dispatchEvent(dragEvent('drop'));
    fixture.detectChanges();
    expect(component.isDragOver()).toBe(false);
  });

  it('moves to uploading and starts uploads up to the concurrency limit', () => {
    const files = [1, 2, 3, 4, 5].map((i) => makeFile(`file-${i}.pdf`, MB));
    dropFiles(files);

    expect(component.state()).toBe('uploading');
    expect(component.items().length).toBe(5);
    expect(getUploadItem().length).toBe(5);

    const uploading = component.items().filter((item) => item.status === 'uploading').length;
    const queued = component.items().filter((item) => item.status === 'queued').length;
    expect(uploading).toBe(3);
    expect(queued).toBe(2);
  });

  it('completes all files and transitions to the completed state', async () => {
    const files = [makeFile('a.pdf', 0.2 * MB), makeFile('b.png', 0.2 * MB)];
    dropFiles(files);

    for (let i = 0; i < 40 && component.state() !== 'completed'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      fixture.detectChanges();
    }

    expect(component.state()).toBe('completed');
    expect(component.doneFiles()).toBe(2);
    const doneRows = fixture.debugElement.queryAll(By.css('.upload-item__status--done'));
    expect(doneRows.length).toBe(2);
    expect(doneRows.every((row) => row.nativeElement.textContent.includes('Готово'))).toBe(true);
  });

  it('shows only limited rows until show all is toggled', () => {
    const files = [1, 2, 3, 4, 5, 6, 7].map((i) => makeFile(`f${i}.pdf`, MB));
    dropFiles(files);

    expect(getUploadItem().length).toBe(component.visibleLimit);
    expect(fixture.debugElement.query(By.css('.uploader__footer'))).not.toBeNull();

    fixture.debugElement.query(By.css('.uploader__show-all')).nativeElement.click();
    fixture.detectChanges();

    expect(getUploadItem().length).toBe(7);
  });

  it('collapses the header list', () => {
    const files = [makeFile('solo.pdf', MB)];
    dropFiles(files);

    fixture.debugElement.query(By.css('.uploader__collapse')).nativeElement.click();
    fixture.detectChanges();

    expect(component.isCollapsed()).toBe(true);
    expect(fixture.debugElement.query(By.css('.uploader__list'))).toBeNull();
  });

  it('rejects files with unsupported extensions and wrong size silently', () => {
    const files = [makeFile('virus.exe', MB), makeFile('huge.pdf', 30 * MB)];
    dropFiles(files);

    expect(component.items().length).toBe(0);
    expect(component.state()).toBe('idle');
  });

  it('skips duplicate files within one drop', () => {
    const same = makeFile('plan.pdf', MB);
    dropFiles([same, makeFile('plan.pdf', MB), makeFile('other.pdf', MB)]);

    const names = component.items().map((item) => item.name);
    expect(names).toEqual(['plan.pdf', 'other.pdf']);
  });

  it('skips files already added in previous drops', () => {
    dropFiles([makeFile('plan.pdf', MB)]);
    dropFiles([makeFile('plan.pdf', MB), makeFile('new.dwg', MB)]);

    const names = component.items().map((item) => item.name);
    expect(names).toEqual(['plan.pdf', 'new.dwg']);
    expect(component.state()).toBe('uploading');
  });

  it('removes a completed item and resets to idle when the last file is removed', async () => {
    const files = [makeFile('single.pdf', 0.2 * MB)];
    dropFiles(files);

    for (let i = 0; i < 40 && component.state() !== 'completed'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      fixture.detectChanges();
    }
    expect(component.state()).toBe('completed');

    const removeBtn = fixture.debugElement.query(
      By.css('.upload-item__action[aria-label="Удалить"]')
    );
    removeBtn.nativeElement.click();
    fixture.detectChanges();

    expect(component.items().length).toBe(0);
    expect(component.state()).toBe('idle');
    expect(fixture.debugElement.query(By.css('.uploader'))).toBeNull();
  });

  it('renders per-file progress percent and status text', () => {
    const files = [1, 2, 3, 4, 5, 6].map((i) => makeFile(`f${i}.pdf`, 5 * MB));
    dropFiles(files);

    const texts = getUploadItem().map((el) => el.nativeElement.textContent);
    expect(texts.some((t: string) => t.includes('Загружается'))).toBe(true);
    expect(texts.some((t: string) => t.includes('В очереди'))).toBe(true);
    expect(texts.some((t: string) => t.includes('%'))).toBe(true);
  });
});

describe('DragNDropComponent accessibility', () => {
  let fixture: ComponentFixture<TestHost>;
  let component: DragNDropComponent;
  let uploadSpy: ReturnType<typeof vi.spyOn>;

  const getDropzone = () => fixture.debugElement.query(By.css('.dropzone__area'));

  function dropFiles(files: File[]): void {
    const event = new Event('drop', { bubbles: true }) as unknown as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: { files } });
    getDropzone().nativeElement.dispatchEvent(event);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [{ provide: UPLOAD_SIMULATOR_TIMING, useValue: FAST_TIMING }]
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    component = fixture.debugElement.query(By.directive(DragNDropComponent))
      .componentInstance as DragNDropComponent;

    uploadSpy = vi
      .spyOn(TestBed.inject(UploadSimulatorService), 'upload')
      .mockImplementation(() => new Observable<number>(() => () => undefined));

    fixture.detectChanges();
  });

  afterEach(() => {
    uploadSpy.mockRestore();
  });

  it('exposes the uploader region with progressbar semantics', async () => {
    uploadSpy.mockImplementation(
      (item: UploadItem, options: UploadSimulatorOptions = {}) =>
        new Observable<number>(() => {
          options.onProgress?.(item.size / 4);
          return () => undefined;
        })
    );

    dropFiles([makeFile('a.pdf', 10 * MB), makeFile('b.pdf', 10 * MB)]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();

    const region = fixture.debugElement.query(By.css('[role="region"]'));
    expect(region.nativeElement.getAttribute('aria-label')).toBe('Загрузка файлов');

    const bar = fixture.debugElement.query(By.css('[role="progressbar"]'));
    expect(bar.nativeElement.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.nativeElement.getAttribute('aria-valuemax')).toBe('100');
    expect(Number(bar.nativeElement.getAttribute('aria-valuenow'))).toBe(25);
    expect(
      fixture.debugElement.query(By.css('.uploader__summary[aria-live="polite"]'))
    ).not.toBeNull();
  });

  it('reflects collapse and show-all state through aria-expanded', () => {
    dropFiles([1, 2, 3, 4, 5, 6].map((i) => makeFile(`f${i}.pdf`, 10 * MB)));

    const collapse = fixture.debugElement.query(By.css('.uploader__collapse'));
    expect(collapse.nativeElement.getAttribute('aria-expanded')).toBe('true');
    expect(collapse.nativeElement.getAttribute('aria-controls')).toBe('uploader-list');
    expect(fixture.debugElement.query(By.css('#uploader-list'))).not.toBeNull();

    component.toggleCollapse();
    fixture.detectChanges();
    expect(
      fixture.debugElement
        .query(By.css('.uploader__collapse'))
        .nativeElement.getAttribute('aria-expanded')
    ).toBe('false');
    expect(fixture.debugElement.query(By.css('#uploader-list'))).toBeNull();
    component.toggleCollapse();
    fixture.detectChanges();

    component.toggleShowAll();
    fixture.detectChanges();
    const showAll = fixture.debugElement.query(By.css('.uploader__show-all'));
    expect(showAll.nativeElement.getAttribute('aria-expanded')).toBe('true');
    component.toggleShowAll();
    fixture.detectChanges();
    expect(
      fixture.debugElement
        .query(By.css('.uploader__show-all'))
        .nativeElement.getAttribute('aria-expanded')
    ).toBe('false');
  });
});

describe('DragNDropComponent with controlled simulator', () => {
  let fixture: ComponentFixture<TestHost>;
  let component: DragNDropComponent;
  let uploadSpy: ReturnType<typeof vi.spyOn>;
  let lastOptions: UploadSimulatorOptions | null;

  const getDropzone = () => fixture.debugElement.query(By.css('.dropzone__area'));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [{ provide: UPLOAD_SIMULATOR_TIMING, useValue: FAST_TIMING }]
    }).compileComponents();

    fixture = TestBed.createComponent(TestHost);
    component = fixture.debugElement.query(By.directive(DragNDropComponent))
      .componentInstance as DragNDropComponent;

    lastOptions = null;
    uploadSpy = vi
      .spyOn(TestBed.inject(UploadSimulatorService), 'upload')
      .mockImplementation((item: UploadItem, options: UploadSimulatorOptions = {}) => {
        lastOptions = options;
        let uploaded = 0;
        return new Observable<number>((observer) => {
          const timer = setInterval(() => {
            uploaded = Math.min(uploaded + MB, item.size);
            options.onProgress?.(uploaded);
            if (uploaded >= item.size) {
              clearInterval(timer);
              observer.next(uploaded);
              observer.complete();
            }
          }, 5);
          return () => clearInterval(timer);
        });
      });

    fixture.detectChanges();
  });

  afterEach(() => {
    uploadSpy.mockRestore();
  });

  it('does not exceed the concurrency limit with a controlled simulator', async () => {
    const files = [1, 2, 3, 4, 5, 6].map((i) => makeFile(`c${i}.pdf`, 2 * MB));
    getDropzone().nativeElement.dispatchEvent(dragEvent('drop', files));
    fixture.detectChanges();

    const started = uploadSpy.mock.calls.length;
    expect(started).toBe(3);

    const item = component.items().find((it) => it.status === 'uploading')!;
    lastOptions?.onProgress?.(item.size);
    await new Promise((resolve) => setTimeout(resolve, 30));
    fixture.detectChanges();

    const startedAfter = uploadSpy.mock.calls.length;
    expect(startedAfter).toBeGreaterThan(started);
    expect(startedAfter).toBeLessThanOrEqual(6);
  });

  it('toggles signal inputs like showAllFiles via component API', () => {
    component.showAllFiles.set(true);
    expect(component.showAllFiles()).toBe(true);
    component.showAllFiles.set(false);
    expect(component.showAllFiles()).toBe(false);
  });

  it('shows «X из Y» under the name while a file is uploading', async () => {
    uploadSpy.mockImplementation(
      (item: UploadItem, options: UploadSimulatorOptions = {}) =>
        new Observable<number>(() => {
          const timer = setTimeout(() => {
            options.onProgress?.(item.size / 2);
          }, 5);
          return () => clearTimeout(timer);
        })
    );

    getDropzone().nativeElement.dispatchEvent(dragEvent('drop', [makeFile('half.pdf', 10 * MB)]));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 30));
    fixture.detectChanges();

    const size = fixture.debugElement.query(By.css('.upload-item__size'));
    expect(size.nativeElement.textContent.trim()).toBe('5 МБ из 10 МБ');
  });

  it('marks a failed upload as error instead of removing it', async () => {
    uploadSpy.mockImplementation(
      () =>
        new Observable<number>((observer) => {
          observer.error(new Error('boom'));
          return () => undefined;
        })
    );

    getDropzone().nativeElement.dispatchEvent(dragEvent('drop', [makeFile('bad.pdf', MB)]));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 10));
    fixture.detectChanges();

    expect(component.items().length).toBe(1);
    expect(component.items()[0].status).toBe('error');
    expect(fixture.debugElement.query(By.css('.upload-item__status--error'))).not.toBeNull();
    expect(
      fixture.debugElement.query(By.css('.upload-item__action[aria-label="Повторить"]'))
    ).not.toBeNull();
  });

  it('retries a failed upload and completes it', async () => {
    uploadSpy.mockImplementation(
      () =>
        new Observable<number>((observer) => {
          observer.error(new Error('boom'));
          return () => undefined;
        })
    );
    getDropzone().nativeElement.dispatchEvent(dragEvent('drop', [makeFile('flaky.pdf', MB)]));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(component.items()[0].status).toBe('error');

    uploadSpy.mockImplementation((item: UploadItem, options: UploadSimulatorOptions = {}) => {
      let uploaded = 0;
      return new Observable<number>((observer) => {
        const timer = setInterval(() => {
          uploaded = Math.min(uploaded + MB, item.size);
          options.onProgress?.(uploaded);
          if (uploaded >= item.size) {
            clearInterval(timer);
            observer.next(uploaded);
            observer.complete();
          }
        }, 5);
        return () => clearInterval(timer);
      });
    });

    fixture.debugElement
      .query(By.css('.upload-item__action[aria-label="Повторить"]'))
      .nativeElement.click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 30));
    fixture.detectChanges();

    expect(component.items()[0].status).toBe('done');
    expect(component.state()).toBe('completed');
  });

  it('drops the speed to zero when the upload stalls', async () => {
    getDropzone().nativeElement.dispatchEvent(dragEvent('drop', [makeFile('stall.pdf', 10 * MB)]));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 30));
    fixture.detectChanges();
    expect(component.bytesPerSecond()).toBeGreaterThan(0);

    const sameBytes = component.uploadedBytes();
    const nowSpy = vi.spyOn(Date, 'now');
    try {
      nowSpy.mockReturnValue(Date.now() + 6000);
      lastOptions?.onProgress?.(sameBytes);
      fixture.detectChanges();

      expect(component.bytesPerSecond()).toBe(0);
      expect(component.etaSeconds()).toBe(Infinity);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
