import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { Taskbar } from '../../pages/dashboard/taskbar/taskbar';
import { TaskbarNav } from './taskbar-nav';

@Component({
  imports: [Taskbar, TaskbarNav],
  template: `<app-taskbar appTaskbarNav />`,
})
class Host {}

@Component({ template: '' })
class Page {}

describe('TaskbarNav', () => {
  let fixture: ComponentFixture<Host>;
  let router: Router;
  let navigate: ReturnType<typeof vi.spyOn>;

  const taskbar = (): HTMLElement => fixture.nativeElement.querySelector('app-taskbar');
  const click = (selector: string) =>
    fixture.nativeElement.querySelector(selector).dispatchEvent(new MouseEvent('click', { bubbles: true }));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideRouter([{ path: 'dashboard', component: Page }, { path: 'calendar', component: Page }])],
    }).compileComponents();
    router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('opens the calendar from the calendar button, also when its icon is clicked', () => {
    click('.calendar-window path');
    expect(navigate).toHaveBeenCalledWith(['/calendar']);
  });

  it('goes back to the chats from the chat button', () => {
    click('.chat-window');
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('ignores clicks on the bar itself', () => {
    click('.bubble');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('marks the page the user is on', async () => {
    expect(taskbar().hasAttribute('data-page')).toBe(false);

    await router.navigateByUrl('/calendar');
    await fixture.whenStable();
    expect(taskbar().getAttribute('data-page')).toBe('calendar');

    await router.navigateByUrl('/dashboard');
    await fixture.whenStable();
    expect(taskbar().getAttribute('data-page')).toBe('chat');
  });
});
