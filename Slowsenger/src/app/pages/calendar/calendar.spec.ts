import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Calendar } from './calendar';

describe('Calendar', () => {
  let component: Calendar;
  let fixture: ComponentFixture<Calendar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Calendar],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Calendar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('moves between months and back to today', () => {
    const month = component.viewMonth();
    component.shiftMonth(1);
    expect(component.viewMonth()).toBe((month + 1) % 12);
    component.goToToday();
    expect(component.viewMonth()).toBe(month);
  });

  it('turns to the month of a day picked from the edge of the grid', () => {
    component.select(new Date(2026, 0, 31));
    expect(component.viewYear()).toBe(2026);
    expect(component.viewMonth()).toBe(0);
    expect(component.selected()).toEqual(new Date(2026, 0, 31));
  });
});
