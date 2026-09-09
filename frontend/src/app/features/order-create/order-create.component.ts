import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
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

  readonly textareaSymbolsCount = signal<number>(0);
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

  readonly orderForm = this.fb.group({
    description: ['', [Validators.required, Validators.maxLength(this.MAX_SYMBOLS)]],
    projectType: ['', Validators.required],
    priority: ['']
  });

  onInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;

    this.textareaSymbolsCount.set(target.value.length);
  }

  onSubmit() {
    if (this.orderForm.invalid) {
      this.orderForm.markAllAsTouched();
      return;
    }
    console.log('Order payload', this.orderForm.getRawValue());
  }
}
