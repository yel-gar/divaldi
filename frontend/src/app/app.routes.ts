import { Routes } from '@angular/router';
import { OrderCreateComponent } from './features/order-create/order-create.component';
import { CalculationChatComponent } from './features/calculation-chat/calculation-chat.component';
import { Layout } from './shared/components/layout/layout.component';
import { ADMIN_NAV_ITEMS, USER_NAV_ITEMS } from './shared/components/sidebar/sidebar.config';
import { HistoryPage } from './pages/history-page/history-page.component';
import { SettingsPage } from './pages/settings-page/settings-page.component';
import { ProfilePage } from './pages/profile-page/profile-page';
import { LoginPageComponent } from './pages/login-page/login-page.component';
import { adminGuard, authGuard, publicGuard } from './core/guards/auth.guard';
import { UsersPageComponent } from './pages/admin/users-page/users-page.component';
import { SectionPlaceholder } from './shared/components/section-placeholder/section-placeholder.component';

export const routes: Routes = [
  {
    path: 'login',
    component: LoginPageComponent,
    canActivate: [publicGuard]
  },
  {
    path: 'admin',
    component: Layout,
    canActivate: [authGuard, adminGuard],
    data: { navItems: ADMIN_NAV_ITEMS, role: 'admin' },
    children: [
      { path: '', redirectTo: '/admin/users', pathMatch: 'full' },
      { path: 'users', component: UsersPageComponent },
      {
        path: 'actions',
        component: SectionPlaceholder,
        data: { title: 'Журнал действий', subtitle: 'История действий пользователей' }
      },
      {
        path: 'settings',
        component: SectionPlaceholder,
        data: { title: 'Настройки', subtitle: 'Параметры работы системы' }
      },
      {
        path: 'system',
        component: SectionPlaceholder,
        data: { title: 'О системе', subtitle: 'Информация о версии и компонентах' }
      }
    ]
  },
  {
    path: '',
    component: Layout,
    canActivate: [authGuard],
    data: { navItems: USER_NAV_ITEMS, role: 'user' },
    children: [
      { path: '', redirectTo: '/create', pathMatch: 'full' },
      { path: 'create', component: OrderCreateComponent },
      { path: 'settings', component: SettingsPage },
      { path: 'chats', component: HistoryPage },
      { path: 'chats/:id', component: CalculationChatComponent },
      { path: 'profile', component: ProfilePage }
    ]
  }
];
