import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  TemplateRef,
  computed,
  contentChildren,
  inject,
  input,
  model,
  output
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { LucideChevronDown, LucideChevronUp } from '@lucide/angular';

export type TableSortDirection = 'asc' | 'desc';

export interface TableSort {
  column: string | null;
  direction: TableSortDirection;
}

export interface TableColumn<T> {
  key: string;
  label: string;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  visuallyHidden?: boolean;
  text?: (row: T) => string;
}

@Directive({
  selector: 'ng-template[appTableCell]'
})
export class TableCell {
  readonly key = input.required<string>({ alias: 'appTableCell' });
  readonly template = inject<TemplateRef<unknown>>(TemplateRef);
}

@Component({
  selector: 'app-table',
  imports: [NgTemplateOutlet, LucideChevronUp, LucideChevronDown],
  templateUrl: './table.component.html',
  styleUrl: './table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Table<T> {
  readonly columns = input.required<TableColumn<T>[]>();
  readonly rows = input.required<T[]>();
  readonly rowKey = input.required<(row: T) => string | number>();
  readonly sort = model<TableSort>({ column: null, direction: 'asc' });
  readonly interactiveRows = input(false);
  readonly rowClick = output<T>();

  readonly cells = contentChildren(TableCell);

  private readonly cellsByKey = computed(
    () => new Map(this.cells().map((cell) => [cell.key(), cell]))
  );

  protected toggleSort(column: TableColumn<T>): void {
    if (!column.sortable) {
      return;
    }
    const current = this.sort();
    this.sort.set({
      column: column.key,
      direction: current.column === column.key && current.direction === 'asc' ? 'desc' : 'asc'
    });
  }

  protected ariaSortFor(column: TableColumn<T>): 'ascending' | 'descending' | 'none' {
    const current = this.sort();
    if (current.column !== column.key) {
      return 'none';
    }
    return current.direction === 'asc' ? 'ascending' : 'descending';
  }

  protected sortIconFor(column: TableColumn<T>): 'up' | 'down' | null {
    const current = this.sort();
    if (current.column !== column.key) {
      return null;
    }
    return current.direction === 'asc' ? 'up' : 'down';
  }

  protected cellFor(column: TableColumn<T>) {
    return this.cellsByKey().get(column.key);
  }

  protected onRowClick(row: T): void {
    if (this.interactiveRows()) {
      this.rowClick.emit(row);
    }
  }
}
