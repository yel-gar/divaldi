import { Routes } from '@angular/router';
import { OrderCreateComponent } from './features/order-create/order-create.component';
import { CalculationChatComponent } from './features/calculation-chat/calculation-chat.component';
import { ResultViewComponent } from './features/result-view/result-view.component';

export const routes: Routes = [
  { path: '', redirectTo: '/create', pathMatch: 'full' },
  { path: 'create', component: OrderCreateComponent },
  { path: 'chat/:id', component: CalculationChatComponent },
  { path: 'result/:id', component: ResultViewComponent },
  { path: '**', redirectTo: '/create' }
];
