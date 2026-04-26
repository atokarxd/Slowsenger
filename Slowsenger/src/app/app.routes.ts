import { Routes } from '@angular/router';
import { authGuard } from './pages/auth/auth-guard';

export const routes: Routes = [
    {
        path: '',
        loadComponent: () => import('./pages/welcome-pages/welcome-pages').then(m => m.WelcomePages)
    },
    {
        path: 'auth/login',
        loadComponent: () => import('./pages/auth/login/login').then(m => m.Login)
    },
    {
        path: 'auth/registration',
        loadComponent: () => import('./pages/auth/regist/regist').then(m => m.Regist)
    },
    {
        path: 'dashboard',
        canActivate: [authGuard],
        loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard)
    },
    /*{
        path: 'loader',
        loadComponent: () => import('./pages/global-loader/global-loader').then(m => m.GlobalLoader)
    },*/
    {
        path: 'auth/meta/callback',
        loadComponent: () => import('./pages/auth/meta-callback/meta-callback').then(m => m.MetaCallback)
    },
    {
        path: '**',
        loadComponent: () => import('./pages/not-found/not-found').then(m => m.NotFound)
    }
];
