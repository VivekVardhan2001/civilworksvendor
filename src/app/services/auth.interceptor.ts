import { Injectable } from '@angular/core';
import { HttpRequest, HttpHandler, HttpEvent, HttpInterceptor, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Router } from '@angular/router';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
    constructor(private router: Router) { }

    intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
        const token = localStorage.getItem('civilworks_token');

        if (token) {
            request = request.clone({
                setHeaders: {
                    Authorization: `Bearer ${token}`
                }
            });
        }

        return next.handle(request).pipe(
            catchError((error: HttpErrorResponse) => {
                const isAuthEndpoint = request.url.includes('/auth/login') ||
                    request.url.includes('/auth/verify-otp') ||
                    request.url.includes('/auth/send-otp') ||
                    request.url.includes('/vendor-portal/check-mobile') ||
                    request.url.includes('/vendor-portal/verify-otp') ||
                    request.url.includes('/vendor-portal/signup');

                if (!isAuthEndpoint && error.status === 401 && token) {
                    localStorage.removeItem('civilworks_token');
                    localStorage.removeItem('civilworks_user');
                    if (!this.router.url.includes('/login') && !this.router.url.includes('/splash') && !this.router.url.includes('/vendor-portal')) {
                        this.router.navigate(['/login'], { queryParams: { returnUrl: this.router.url } });
                    }
                }
                return throwError(() => error);
            })
        );
    }
}

