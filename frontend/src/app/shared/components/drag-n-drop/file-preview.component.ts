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
import { LucideFileWarning, LucideX } from '@lucide/angular';
import { getFileExtension } from '../../utils/upload-format';
import { SkeletonFilePreviewComponent } from '../skeleton/skeleton-file-preview/skeleton-file-preview.component';
import { PreviewKind, mimeTypeFor, previewKindFor } from './file-preview.model';

type XLSXModule = typeof import('xlsx');
type HyperFormulaCtor = typeof import('hyperformula').HyperFormula;

const RUSSIAN_FUNCTION_MAP = new Map([
  ['СУММ', 'SUM'],
  ['ЕСЛИ', 'IF'],
  ['СРЗНАЧ', 'AVERAGE'],
  ['МАКС', 'MAX'],
  ['МИН', 'MIN'],
  ['ОКРУГЛ', 'ROUND'],
  ['ОКРУГЛВВЕРХ', 'ROUNDUP'],
  ['ОКРУГЛВНИЗ', 'ROUNDDOWN'],
  ['КОРЕНЬ', 'SQRT'],
  ['СТЕПЕНЬ', 'POWER'],
  ['ПРОИЗВЕД', 'PRODUCT'],
  ['СЧЁТ', 'COUNT'],
  ['СЧЁТЕСЛИ', 'COUNTIF'],
  ['СУММЕСЛИ', 'SUMIF'],
  ['ОСТАТ', 'MOD'],
  ['ЦЕЛОЕ', 'INT']
]);

@Component({
  selector: 'app-file-preview',
  imports: [LucideFileWarning, LucideX, SkeletonFilePreviewComponent],
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
  private isClosing = false;
  private finishCloseListener: (() => void) | null = null;

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

  private runWithExitAnimation(dialog: HTMLDialogElement, onDone: () => void): () => void {
    dialog.classList.add('file-preview--closing');

    let finished = false;
    const finish = (): void => {
      if (finished) {
        return;
      }
      finished = true;
      dialog.removeEventListener('animationend', finish);
      clearTimeout(fallbackTimer);
      onDone();
    };

    const fallbackTimer = setTimeout(finish, 400);
    dialog.addEventListener('animationend', finish);

    return () => {
      dialog.removeEventListener('animationend', finish);
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
    for (const other of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) {
      if (other !== dialog) {
        other.close();
      }
    }
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
    const workbook = XLSX.read(buffer, {
      type: 'array',
      cellStyles: true,
      cellFormula: true,
      cellNF: true
    });
    const sheetNames = workbook.SheetNames;
    if (!sheetNames.length) {
      throw new Error('Spreadsheet has no renderable sheets');
    }

    const { HyperFormula } = await import('hyperformula');
    this.evaluateWorkbookFormulas(workbook, XLSX, HyperFormula);

    const workbookEl = document.createElement('div');
    workbookEl.className = 'file-preview__workbook';

    const tabs = document.createElement('div');
    tabs.className = 'file-preview__sheet-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Листы книги');

    const indicator = document.createElement('div');
    indicator.className = 'file-preview__sheet-tab-indicator';
    tabs.appendChild(indicator);

    const sheetArea = document.createElement('div');
    sheetArea.className = 'file-preview__sheet-area';

    const tableHost = document.createElement('div');
    tableHost.className = 'file-preview__sheet-table';
    sheetArea.appendChild(tableHost);

    let activeButton: HTMLButtonElement | null = null;

    const moveIndicator = (button: HTMLButtonElement): void => {
      indicator.style.left = `${button.offsetLeft}px`;
      indicator.style.width = `${button.offsetWidth}px`;
    };

    const selectSheet = (name: string, button: HTMLButtonElement): void => {
      const sheet = workbook.Sheets[name];
      this.moveMergedCellContentToAnchor(sheet, XLSX);
      const table = this.importTableHtml(XLSX.utils.sheet_to_html(sheet), sheet);
      tableHost.replaceChildren();
      if (table) {
        tableHost.appendChild(table);
      }
      activeButton?.classList.remove('file-preview__sheet-tab--active');
      activeButton?.setAttribute('aria-selected', 'false');
      button.classList.add('file-preview__sheet-tab--active');
      button.setAttribute('aria-selected', 'true');
      activeButton = button;
      moveIndicator(button);
    };

    if (typeof ResizeObserver === 'function') {
      const resizeObserver = new ResizeObserver(() => {
        if (activeButton) {
          moveIndicator(activeButton);
        }
      });
      resizeObserver.observe(tabs);
      this.destroyRef.onDestroy(() => resizeObserver.disconnect());
    }

    sheetNames.forEach((name, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'file-preview__sheet-tab';
      button.setAttribute('role', 'tab');
      button.textContent = name;
      button.addEventListener('click', () => selectSheet(name, button));
      tabs.appendChild(button);
      if (index === 0) {
        selectSheet(name, button);
      }
    });

    workbookEl.appendChild(tabs);
    workbookEl.appendChild(sheetArea);
    return workbookEl;
  }

  private evaluateWorkbookFormulas(
    workbook: import('xlsx').WorkBook,
    XLSX: XLSXModule,
    HyperFormula: HyperFormulaCtor
  ): void {
    const sheetNames = workbook.SheetNames;
    const matrices = new Map<string, import('hyperformula').RawCellContent[][]>();
    for (const name of sheetNames) {
      const sheet = workbook.Sheets[name];
      const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
      const rows: import('hyperformula').RawCellContent[][] = [];
      for (let r = 0; r < range.s.r; r++) {
        rows.push(new Array(range.e.c + 1).fill(null));
      }
      for (let r = range.s.r; r <= range.e.r; r++) {
        const row: import('hyperformula').RawCellContent[] = [];
        for (let c = 0; c < range.s.c; c++) {
          row.push(null);
        }
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = sheet[XLSX.utils.encode_cell({ r, c })] as
            import('xlsx').CellObject | undefined;
          row.push(
            cell?.f
              ? `=${this.quoteSheetReferences(this.normalizeFormula(cell.f), sheetNames)}`
              : (cell?.v ?? null)
          );
        }
        rows.push(row);
      }
      matrices.set(name, rows);
    }
    let engine: import('hyperformula').HyperFormula | undefined;
    try {
      engine = HyperFormula.buildFromSheets(
        Object.fromEntries(sheetNames.map((name: string) => [name, matrices.get(name)!])) as Record<
          string,
          import('hyperformula').RawCellContent[][]
        >,
        { licenseKey: 'gpl-v3' }
      );
      for (const name of sheetNames) {
        const sheet = workbook.Sheets[name];
        const sheetId = engine.getSheetId(name)!;
        for (const [addr, cell] of Object.entries(sheet).filter(
          ([key]) => !key.startsWith('!')
        ) as [string, import('xlsx').CellObject][]) {
          if (!cell.f) {
            continue;
          }
          const { r, c } = XLSX.utils.decode_cell(addr);
          const value = engine.getCellValue({ sheet: sheetId, row: r, col: c });
          if (
            typeof value === 'number' ||
            typeof value === 'string' ||
            typeof value === 'boolean'
          ) {
            cell.t = typeof value === 'number' ? 'n' : typeof value === 'boolean' ? 'b' : 's';
            cell.v = value;
            delete cell.w;
          }
        }
      }
    } catch {
      return;
    } finally {
      engine?.destroy();
    }
  }

  private normalizeFormula(formula: string): string {
    return formula.replace(/[А-ЯЁ]+/g, (name) => RUSSIAN_FUNCTION_MAP.get(name) ?? name);
  }

  private moveMergedCellContentToAnchor(sheet: import('xlsx').WorkSheet, XLSX: XLSXModule): void {
    for (const merge of (sheet['!merges'] ?? []) as import('xlsx').Range[]) {
      const anchorAddr = XLSX.utils.encode_cell(merge.s);
      const anchor = sheet[anchorAddr] as import('xlsx').CellObject | undefined;
      if (anchor?.v) {
        continue;
      }
      for (let r = merge.s.r; r <= merge.e.r; r++) {
        for (let c = merge.s.c; c <= merge.e.c; c++) {
          if (r === merge.s.r && c === merge.s.c) {
            continue;
          }
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = sheet[addr] as import('xlsx').CellObject | undefined;
          if (cell?.v) {
            sheet[anchorAddr] = cell;
            delete sheet[addr];
            return;
          }
        }
      }
    }
    const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
    for (let r = range.s.r; r <= range.e.r; r++) {
      const rowCells = [] as (import('xlsx').CellObject | undefined)[];
      for (let c = range.s.c; c <= range.e.c; c++) {
        rowCells.push(sheet[XLSX.utils.encode_cell({ r, c })] as import('xlsx').CellObject);
      }
      const firstDefined = rowCells.findIndex((cell) => cell?.v !== undefined);
      if (firstDefined <= 0) {
        continue;
      }
      const textCell = rowCells[firstDefined];
      const hasLaterNumber = rowCells
        .slice(firstDefined + 1)
        .some((cell) => cell?.t === 'n' && typeof cell.v === 'number');
      if (textCell?.t === 's' && typeof textCell.v === 'string' && hasLaterNumber) {
        const sourceAddr = XLSX.utils.encode_cell({ r, c: range.s.c + firstDefined });
        const targetAddr = XLSX.utils.encode_cell({ r, c: range.s.c });
        sheet[targetAddr] = textCell;
        delete sheet[sourceAddr];
      }
    }
  }

  private quoteSheetReferences(formula: string, sheetNames: string[]): string {
    let result = formula;
    for (const name of [...sheetNames].sort((a, b) => b.length - a.length)) {
      if (/^[A-Za-z0-9_]+$/.test(name)) {
        continue;
      }
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`(?<![\\w'А-Яа-яЁё])${escaped}!`, 'gu'), `'${name}'!`);
    }
    return result;
  }

  private importTableHtml(tableHtml: string, sheet: import('xlsx').WorkSheet): Node | null {
    const sanitized = this.sanitizer.sanitize(SecurityContext.HTML, tableHtml);
    const parsed = new DOMParser().parseFromString(sanitized ?? '', 'text/html');
    const source = parsed.querySelector('table');
    if (!source) {
      return null;
    }
    const table = document.createElement('table');
    const colCount = source.querySelector('tr')?.childElementCount ?? 0;
    if (colCount > 0) {
      const colgroup = document.createElement('colgroup');
      const cols = sheet['!cols'] ?? [];
      for (let i = 0; i < colCount; i++) {
        const col = document.createElement('col');
        const width = cols[i]?.wpx;
        if (width) {
          col.style.width = `${Math.round(width)}px`;
        }
        colgroup.appendChild(col);
      }
      table.appendChild(colgroup);
    }
    for (const row of source.querySelectorAll('tr')) {
      const tr = document.createElement('tr');
      for (const cell of row.querySelectorAll('td, th')) {
        const el = document.createElement(cell.tagName.toLowerCase() === 'th' ? 'th' : 'td');
        for (const attr of ['colspan', 'rowspan'] as const) {
          const value = cell.getAttribute(attr);
          if (value) {
            el.setAttribute(attr, value);
          }
        }
        const type = cell.getAttribute('data-t');
        if (type) {
          el.setAttribute('data-t', type);
        }
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
