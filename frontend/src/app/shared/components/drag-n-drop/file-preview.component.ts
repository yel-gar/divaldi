import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  SecurityContext,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { LucideFileWarning, LucideLoaderCircle, LucideX } from '@lucide/angular';
import { getFileExtension } from '../../utils/upload-format';
import { PreviewKind, mimeTypeFor, previewKindFor } from './file-preview.model';

@Component({
  selector: 'app-file-preview',
  imports: [LucideFileWarning, LucideLoaderCircle, LucideX],
  templateUrl: './file-preview.component.html',
  styleUrl: './file-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None
})
export class FilePreviewComponent implements AfterViewInit {
  readonly file = input.required<File>();
  readonly closed = output<void>();

  readonly phase = signal<'loading' | 'ready' | 'error'>('loading');
  readonly kind = computed<PreviewKind | null>(() =>
    previewKindFor(getFileExtension(this.file().name))
  );
  readonly extLabel = computed(() =>
    getFileExtension(this.file().name).replace('.', '').toUpperCase()
  );

  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialogEl');
  private readonly bodyHost = viewChild.required<ElementRef<HTMLElement>>('bodyHost');
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);

  private objectUrls: string[] = [];
  private renderedFile: File | null = null;
  private renderSeq = 0;

  constructor() {
    effect(() => {
      const file = this.file();
      if (this.renderedFile !== null && file !== this.renderedFile) {
        void this.render(file);
      }
    });
  }

  ngAfterViewInit(): void {
    this.openDialog();
    void this.render(this.file());
    this.destroyRef.onDestroy(() => {
      this.revokeObjectUrls();
      this.finishCloseListener?.();
    });
  }

  close(): void {
    if (this.isClosing) {
      return;
    }
    this.isClosing = true;

    const dialog = this.dialogRef().nativeElement;
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion || typeof dialog.close !== 'function' || !dialog.open) {
      this.teardownDialog(dialog);
      return;
    }

    this.finishCloseListener = this.runWithExitAnimation(dialog, () => this.teardownDialog(dialog));
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialogRef().nativeElement) {
      this.close();
    }
  }

  private isClosing = false;

  private finishCloseListener: (() => void) | null = null;

  private runWithExitAnimation(dialog: HTMLDialogElement, onDone: () => void): () => void {
    dialog.classList.add('file-preview--closing');

    const panel = dialog.querySelector('.file-preview__panel');
    const animated = panel instanceof HTMLElement ? panel : dialog;

    let finished = false;
    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      animated.removeEventListener('animationend', finish);
      clearTimeout(fallbackTimer);
      onDone();
    };

    const fallbackTimer = setTimeout(finish, 400);
    animated.addEventListener('animationend', finish);

    return () => {
      animated.removeEventListener('animationend', finish);
      clearTimeout(fallbackTimer);
    };
  }

  private teardownDialog(dialog: HTMLDialogElement): void {
    if (typeof dialog.close === 'function' && dialog.open) {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
    this.closed.emit();
  }

  private openDialog(): void {
    const dialog = this.dialogRef().nativeElement;
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  private async render(file: File): Promise<void> {
    const seq = ++this.renderSeq;
    this.setPhase('loading');
    this.revokeObjectUrls();
    this.renderedFile = file;
    const body = this.bodyHost().nativeElement;
    body.replaceChildren();
    const kind = this.kind();
    try {
      if (!kind) {
        throw new Error('Unsupported preview format');
      }
      let content: Node;
      if (kind === 'image') {
        content = this.renderImage(file);
      } else if (kind === 'pdf') {
        content = this.renderPdf(file);
      } else if (kind === 'docx') {
        content = await this.renderDocx(file);
      } else {
        content = await this.renderSpreadsheet(file);
      }
      if (seq !== this.renderSeq) {
        return;
      }
      body.appendChild(content);
      this.setPhase('ready');
    } catch {
      if (seq === this.renderSeq) {
        this.setPhase('error');
      }
    }
  }

  private setPhase(phase: 'loading' | 'ready' | 'error'): void {
    this.phase.set(phase);
  }

  private renderImage(file: File): HTMLElement {
    const image = document.createElement('img');
    image.className = 'file-preview__image';
    image.alt = file.name;
    image.src = this.createObjectUrl(file);
    return image;
  }

  private renderPdf(file: File): HTMLElement {
    const frame = document.createElement('iframe');
    frame.className = 'file-preview__pdf';
    frame.title = file.name;
    frame.src = this.createObjectUrl(file);
    return frame;
  }

  private async renderDocx(file: File): Promise<HTMLElement> {
    const buffer = await file.arrayBuffer();
    const { renderAsync } = await import('docx-preview');
    const container = document.createElement('div');
    container.className = 'file-preview__docx';
    await renderAsync(buffer, container);
    return container;
  }

  private async renderSpreadsheet(file: File): Promise<Node> {
    const buffer = await file.arrayBuffer();
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer);
    const sections = document.createDocumentFragment();

    for (const sheetName of workbook.SheetNames) {
      const tableHtml = XLSX.utils.sheet_to_html(workbook.Sheets[sheetName]);
      const table = this.importTableHtml(tableHtml);
      if (!table) {
        continue;
      }
      const section = document.createElement('section');
      section.className = 'file-preview__sheet';

      const heading = document.createElement('h3');
      heading.className = 'file-preview__sheet-name h5';
      heading.textContent = sheetName;

      const tableHost = document.createElement('div');
      tableHost.className = 'file-preview__sheet-table';
      tableHost.appendChild(table);

      section.appendChild(heading);
      section.appendChild(tableHost);
      sections.appendChild(section);
    }

    if (!sections.childElementCount) {
      throw new Error('Spreadsheet has no renderable sheets');
    }
    return sections;
  }

  private importTableHtml(tableHtml: string): Node | null {
    const sanitized = this.sanitizer.sanitize(SecurityContext.HTML, tableHtml);
    const parsed = new DOMParser().parseFromString(sanitized ?? '', 'text/html');
    const source = parsed.querySelector('table');
    if (!source) {
      return null;
    }
    const table = document.createElement('table');
    for (const row of source.querySelectorAll('tr')) {
      const tr = document.createElement('tr');
      for (const cell of row.querySelectorAll('td, th')) {
        const el = document.createElement(cell.tagName.toLowerCase() === 'th' ? 'th' : 'td');
        el.textContent = cell.textContent;
        tr.appendChild(el);
      }
      if (tr.childElementCount > 0) {
        table.appendChild(tr);
      }
    }
    return table.childElementCount ? table : null;
  }

  private createObjectUrl(file: File): string {
    const mimeType = mimeTypeFor(getFileExtension(file.name));
    const url = URL.createObjectURL(file.slice(0, file.size, mimeType));
    this.objectUrls.push(url);
    return url;
  }

  private revokeObjectUrls(): void {
    for (const url of this.objectUrls) {
      if (typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(url);
      }
    }
    this.objectUrls = [];
  }
}
