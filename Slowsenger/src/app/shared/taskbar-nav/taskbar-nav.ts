import { Directive, HostListener, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

/**
 * Lets the taskbar's buttons switch pages without changing the Taskbar component:
 * clicks on its .chat-window and .calendar-window elements bubble up to <app-taskbar>.
 * It also marks the current page on <app-taskbar> as data-page="chat" or "calendar",
 * which the taskbar's styles use to highlight that button.
 */
@Directive({
  selector: 'app-taskbar[appTaskbarNav]',
  host: { '[attr.data-page]': 'page()' },
})
export class TaskbarNav {
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url)
    ),
    { initialValue: this.router.url }
  );

  readonly page = computed(() => {
    if (this.url().startsWith('/calendar')) return 'calendar';
    if (this.url().startsWith('/dashboard')) return 'chat';
    return null;
  });

  @HostListener('click', ['$event.target'])
  onClick(target: EventTarget | null): void {
    if (!(target instanceof Element)) return;

    if (target.closest('.calendar-window')) {
      this.router.navigate(['/calendar']);
    } else if (target.closest('.chat-window')) {
      this.router.navigate(['/dashboard']);
    }
  }
}
