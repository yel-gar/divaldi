import { Component, input } from '@angular/core';

@Component({
  selector: 'app-calculation-chat',
  standalone: true,
  templateUrl: './calculation-chat.html',
  styleUrl: './calculation-chat.scss'
})
export class CalculationChatComponent {
  readonly id = input.required<string>();
}
