import { Routes } from '@angular/router';
import { OrderCreateComponent } from './features/order-create/order-create.component';
import { CalculationChatComponent } from './features/calculation-chat/calculation-chat.component';
import { ResultViewComponent } from './features/result-view/result-view.component';
import { Layout } from './shared/components/layout/layout.component';
import { ADMIN_NAV_ITEMS, USER_NAV_ITEMS } from './shared/components/sidebar/sidebar.config';
import { ChatsPage } from './pages/chats-page/chats-page.component';
import { HistoryPage } from './pages/history-page/history-page.component';
import { SettingsPage } from './pages/settings-page/settings-page.component';

export const routes: Routes = [
  {
    path: '',
    component: Layout,
    data: { navItems: USER_NAV_ITEMS },
    children: [
      { path: '', redirectTo: '/create', pathMatch: 'full' },
      { path: 'chats', component: ChatsPage },
      { path: 'create', component: OrderCreateComponent },
      { path: 'history', component: HistoryPage },
      { path: 'settings', component: SettingsPage },
      { path: 'chats/:id', component: CalculationChatComponent },
      { path: 'results/:id', component: ResultViewComponent }
    ]
  },
  {
    path: 'admin',
    component: Layout,
    data: { navItems: ADMIN_NAV_ITEMS }
  }
  // {
  //   path: 'login',
  //   component:
  // }
];
