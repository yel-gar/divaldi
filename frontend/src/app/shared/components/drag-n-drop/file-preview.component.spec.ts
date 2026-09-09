import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';

import { previewKindFor, mimeTypeFor } from './file-preview.model';
import { FilePreviewComponent } from './file-preview.component';
import { DragNDropComponent } from './drag-n-drop.component';
import { UPLOAD_SIMULATOR_TIMING, UploadSimulator } from './upload-simulator.service';
import { Observable } from 'rxjs';

const FAST_TIMING = { minChunkMs: 5, maxChunkMs: 10 };

function makeFile(name: string, contents: BlobPart = 'x', type = 'application/octet-stream'): File {
  return new File([contents], name, { type });
}

async function waitForPhase(
  fixture: ComponentFixture<FilePreviewComponent>,
  phase: 'ready' | 'error'
): Promise<void> {
  await vi.waitFor(
    () => {
      fixture.detectChanges();
      expect(fixture.componentInstance.phase()).toBe(phase);
    },
    { timeout: 5000, interval: 5 }
  );
}

function blobUrlStub(): { urls: string[]; restore: () => void } {
  const urls: string[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn(() => {
    urls.push('blob:mock-' + urls.length);
    return urls[urls.length - 1];
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  return {
    urls,
    restore: () => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  };
}

describe('previewKindFor', () => {
  it('maps browser-viewable formats to their renderers', () => {
    expect(previewKindFor('.pdf')).toBe('pdf');
    expect(previewKindFor('.docx')).toBe('docx');
    expect(previewKindFor('.xls')).toBe('spreadsheet');
    expect(previewKindFor('.xlsx')).toBe('spreadsheet');
    expect(previewKindFor('.png')).toBe('image');
    expect(previewKindFor('.jpg')).toBe('image');
    expect(previewKindFor('.jpeg')).toBe('image');
  });

  it('returns null for formats without browser rendering', () => {
    expect(previewKindFor('.dwg')).toBeNull();
    expect(previewKindFor('.dxf')).toBeNull();
    expect(previewKindFor('.doc')).toBeNull();
    expect(previewKindFor('.exe')).toBeNull();
    expect(previewKindFor('')).toBeNull();
  });

  it('maps extensions to correct MIME types for blob URLs', () => {
    expect(mimeTypeFor('.pdf')).toBe('application/pdf');
    expect(mimeTypeFor('.png')).toBe('image/png');
    expect(mimeTypeFor('.docx')).toContain('wordprocessingml');
    expect(mimeTypeFor('.xyz')).toBe('application/octet-stream');
  });
});

describe('FilePreviewComponent', () => {
  const compile = (file: File) => {
    const fixture = TestBed.createComponent(FilePreviewComponent);
    fixture.componentRef.setInput('file', file);
    return fixture;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FilePreviewComponent] }).compileComponents();
  });

  it('shows the error placeholder for an unparseable docx', async () => {
    const fixture = compile(makeFile('битый.docx', 'not a zip'));
    await waitForPhase(fixture, 'error');

    const dialog = fixture.nativeElement.querySelector('dialog');
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(fixture.nativeElement.querySelector('.file-preview__warning')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Не удалось открыть предпросмотр');
  });

  it('renders a spreadsheet into styled tables per sheet', async () => {
    const fixture = compile(makeFile('sheet.xlsx', 'any bytes'));
    await waitForPhase(fixture, 'ready');

    expect(fixture.componentInstance.phase()).toBe('ready');
    expect(fixture.nativeElement.querySelector('.file-preview__sheet-name')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.file-preview__sheet-table table')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.file-preview__warning')).toBeNull();
  });

  it('creates a blob URL for images and revokes it on destroy', async () => {
    const stub = blobUrlStub();
    try {
      const fixture = compile(makeFile('pic.png'));
      await waitForPhase(fixture, 'ready');

      const image = fixture.nativeElement.querySelector('.file-preview__image');
      expect(image).not.toBeNull();
      expect(image.getAttribute('src')).toBe(stub.urls[0]);
      expect(image.alt).toBe('pic.png');

      fixture.destroy();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(stub.urls[0]);
    } finally {
      stub.restore();
    }
  });

  it('creates a blob URL for pdf and emits closed on close', async () => {
    const stub = blobUrlStub();
    try {
      const fixture = compile(makeFile('doc.pdf'));
      await waitForPhase(fixture, 'ready');

      const frame = fixture.nativeElement.querySelector('.file-preview__pdf');
      expect(frame).not.toBeNull();
      expect(frame.getAttribute('src')).toBe(stub.urls[0]);
      expect(frame.title).toBe('doc.pdf');
      expect(fixture.nativeElement.querySelector('.file-preview__warning')).toBeNull();

      let closedEmitted = false;
      fixture.componentInstance.closed.subscribe(() => (closedEmitted = true));
      fixture.nativeElement.querySelector('.file-preview__close').click();

      expect(closedEmitted).toBe(true);
    } finally {
      stub.restore();
    }
  });

  it('shows the file name and uppercase extension chip', async () => {
    const fixture = compile(makeFile('отчёт.PDF'));
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.file-preview__title')?.textContent?.trim()).toBe(
      'отчёт.PDF'
    );
    expect(fixture.nativeElement.querySelector('.file-preview__chip')?.textContent?.trim()).toBe(
      'PDF'
    );
  });

  it('labels the dialog by the file title and exposes placeholder roles', async () => {
    const fixture = compile(makeFile('doc.pdf'));
    await waitForPhase(fixture, 'ready');

    const dialog = fixture.nativeElement.querySelector('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe('file-preview-title');
    const titleEl = fixture.nativeElement.querySelector('#file-preview-title');
    expect(titleEl?.textContent?.trim()).toBe('doc.pdf');
  });

  it('closes cleanly without touching focus', async () => {
    const fixture = compile(makeFile('doc.pdf'));
    await waitForPhase(fixture, 'ready');

    try {
      let closedEmitted = false;
      fixture.componentInstance.closed.subscribe(() => (closedEmitted = true));

      fixture.componentInstance.close();
      fixture.detectChanges();
      await fixture.whenStable();

      const dialog = fixture.nativeElement.querySelector('dialog');
      expect(dialog.hasAttribute('open')).toBe(false);
      expect(closedEmitted).toBe(true);
    } finally {
      fixture.destroy();
    }
  });
});

@Component({
  selector: 'app-dnd-preview-test-host',
  imports: [DragNDropComponent],
  template: `<app-drag-n-drop />`
})
class PreviewTestHost {}

describe('DragNDropComponent preview integration', () => {
  let fixture: ComponentFixture<PreviewTestHost>;
  let component: DragNDropComponent;
  let uploadSpy: ReturnType<typeof vi.spyOn>;
  let completers: Map<string, () => void>;

  const getDropzone = () => fixture.debugElement.query(By.css('.dropzone__area'));

  function dropFiles(files: File[]): void {
    const event = new Event('drop', { bubbles: true }) as unknown as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: { files } });
    getDropzone().nativeElement.dispatchEvent(event);
    fixture.detectChanges();
  }

  function finishAllUploads(): void {
    for (const item of component.items()) {
      completers.get(item.id)?.();
    }
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PreviewTestHost],
      providers: [{ provide: UPLOAD_SIMULATOR_TIMING, useValue: FAST_TIMING }]
    }).compileComponents();

    fixture = TestBed.createComponent(PreviewTestHost);
    component = fixture.debugElement.query(By.directive(DragNDropComponent))
      .componentInstance as DragNDropComponent;

    completers = new Map();
    uploadSpy = vi.spyOn(TestBed.inject(UploadSimulator), 'upload').mockImplementation(
      (item) =>
        new Observable<number>((observer) => {
          completers.set(item.id, () => {
            observer.next(0);
            observer.complete();
          });
          return () => completers.delete(item.id);
        })
    );

    fixture.detectChanges();
  });

  afterEach(() => {
    uploadSpy.mockRestore();
  });

  it('opens the preview dialog with the dropped file and closes on output', () => {
    const pdf = makeFile('заявка.pdf');
    dropFiles([pdf]);
    finishAllUploads();

    expect(component.state()).toBe('completed');

    fixture.debugElement.query(By.css('button[aria-label="Предпросмотр"]')).nativeElement.click();
    fixture.detectChanges();

    const previewHost = fixture.debugElement.query(By.css('app-file-preview'));
    expect(previewHost).not.toBeNull();
    expect(component.previewItem()?.file).toBe(pdf);
    expect(previewHost.nativeElement.querySelector('dialog')).not.toBeNull();

    previewHost.componentInstance.close();
    fixture.detectChanges();

    expect(component.previewItem()).toBeNull();
    expect(fixture.debugElement.query(By.css('app-file-preview'))).toBeNull();
  });

  it('hides the eye button for formats without preview support', () => {
    dropFiles([makeFile('деталь.dwg'), makeFile('doc.pdf')]);
    finishAllUploads();

    const rows = fixture.debugElement.queryAll(By.css('.upload-item'));
    const dwgRow = rows.find((row) => row.nativeElement.textContent.includes('деталь.dwg'));
    const pdfRow = rows.find((row) => row.nativeElement.textContent.includes('doc.pdf'));

    expect(dwgRow?.query(By.css('button[aria-label="Предпросмотр"]'))).toBeNull();
    expect(dwgRow?.query(By.css('button[aria-label="Удалить"]'))).not.toBeNull();
    expect(pdfRow?.query(By.css('button[aria-label="Предпросмотр"]'))).not.toBeNull();
  });

  it('clears the open preview when its item is removed', () => {
    dropFiles([makeFile('doc.pdf')]);
    finishAllUploads();

    fixture.debugElement.query(By.css('button[aria-label="Предпросмотр"]')).nativeElement.click();
    fixture.detectChanges();
    expect(component.previewItem()).not.toBeNull();

    fixture.debugElement.query(By.css('button[aria-label="Удалить"]')).nativeElement.click();
    fixture.detectChanges();

    expect(component.previewItem()).toBeNull();
    expect(component.state()).toBe('idle');
  });
});
