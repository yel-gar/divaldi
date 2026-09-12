import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { catchError, EMPTY, finalize } from 'rxjs';
import { ChatService } from '../../core/services/chat.service';
import { InitialChatStateService } from '../../core/services/initial-chat-state.service';
import { NotificationService } from '../../core/services/notification.service';
import { DragNDropComponent } from '../../shared/components/drag-n-drop/drag-n-drop.component';
import { Textarea } from '../../shared/components/textarea/textarea.component';
import { LucideArrowRight } from '@lucide/angular';

@Component({
  selector: 'app-order-create',
  standalone: true,
  imports: [DragNDropComponent, Textarea, ReactiveFormsModule, LucideArrowRight],
  templateUrl: './order-create.html',
  styleUrl: './order-create.scss'
})
export class OrderCreateComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly chatService = inject(ChatService);
  private readonly initialChatState = inject(InitialChatStateService);
  private readonly notifications = inject(NotificationService);

  readonly isSubmitting = signal<boolean>(false);
  readonly selectedFiles = signal<File[]>([]);
  readonly MAX_SYMBOLS = 1000;

  readonly orderForm = this.fb.nonNullable.group({
    description: ['', [Validators.required, Validators.maxLength(this.MAX_SYMBOLS)]]
  });

  onFilesChange(files: File[]) {
    this.selectedFiles.set(files);
  }

  onSubmit() {
    if (this.orderForm.invalid) {
      this.orderForm.markAllAsTouched();
      this.notifications.error('Заполните все поля заявки');
      return;
    }
    if (this.isSubmitting()) {
      return;
    }

    this.isSubmitting.set(true);
    const { description } = this.orderForm.getRawValue();

    this.chatService
      .create(description.trim())
      .pipe(
        finalize(() => this.isSubmitting.set(false)),
        catchError((err: HttpErrorResponse) => {
          const msg = err.error?.detail || err.error?.message || err.message || 'Ошибка сервера';
          this.notifications.error('Не удалось создать чат: ' + msg);
          return EMPTY;
        })
      )
      .subscribe({
        next: ({ session_id }) => {
          this.notifications.success('Новый чат создан');
          this.initialChatState.set({
            text: description.trim(),
            files: this.selectedFiles()
          });
          this.orderForm.reset();
          this.router.navigate(['/chats', session_id]);
        }
      });
  }
}
