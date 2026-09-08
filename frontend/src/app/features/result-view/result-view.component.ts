import { Component, input } from '@angular/core';

@Component({
  selector: 'app-result-view',
  standalone: true,
  templateUrl: './result-view.html',
  styleUrl: './result-view.scss'
})
export class ResultViewComponent {
  readonly id = input.required<string>();
}
