import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, EMPTY, finalize } from 'rxjs';
import { SessionService } from '../../core/services/session.service';
import { DragNDropComponent } from '../../shared/components/drag-n-drop/drag-n-drop.component';
import { Select, SelectOption } from '../../shared/components/select/select.component';
import { NgClass } from '@angular/common';
import { LucideArrowRight } from '@lucide/angular';

@Component({
  selector: 'app-order-create',
  standalone: true,
  imports: [DragNDropComponent, Select, ReactiveFormsModule, NgClass, LucideArrowRight],
  templateUrl: './order-create.html',
  styleUrl: './order-create.scss'
})
export class OrderCreateComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly sessionService = inject(SessionService);

  readonly textareaSymbolsCount = signal<number>(0);
  readonly isSubmitting = signal<boolean>(false);
  readonly selectedFiles = signal<File[]>([]);
  readonly MAX_SYMBOLS = 1000;

  readonly projectTypeOptions: SelectOption[] = [
    { value: 'internal', label: 'Внутренний проект' },
    { value: 'client', label: 'Клиентский проект' },
    { value: 'research', label: 'Исследование и аналитика' },
    { value: 'support', label: 'Поддержка и развитие' },
    { value: 'other', label: 'Другое' }
  ];

  readonly priorityOptions: SelectOption[] = [
    { value: 'low', label: 'Низкий' },
    { value: 'medium', label: 'Средний' },
    { value: 'high', label: 'Высокий' }
  ];

  readonly orderForm = this.fb.nonNullable.group({
    description: ['', [Validators.required, Validators.maxLength(this.MAX_SYMBOLS)]],
    projectType: ['', Validators.required],
    priority: ['']
  });

  onInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;

    this.textareaSymbolsCount.set(target.value.length);
  }

  onFilesChange(files: File[]) {
    this.selectedFiles.set(files);
  }

  onSubmit() {
    if (this.orderForm.invalid) {
      this.orderForm.markAllAsTouched();
      return;
    }
    if (this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    const { description, projectType, priority } = this.orderForm.getRawValue();

    this.sessionService
      .createSession({
        description,
        projectType,
        priority,
        files: this.selectedFiles()
      })
      // Текст ошибки пользователю показывает errorInterceptor
      .pipe(
        finalize(() => this.isSubmitting.set(false)),
        catchError(() => EMPTY)
      )
      .subscribe({
        next: (order) => {
          this.orderForm.reset();
          this.router.navigate(['/chats', order.id]);
        }
      });
  }
}
