import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SourceMessage } from './source-message';

describe('SourceMessage', () => {
  let fixture: ComponentFixture<SourceMessage>;
  let element: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(SourceMessage);
    element = fixture.nativeElement;
  });

  it('quotes the message with its author and chat', async () => {
    fixture.componentRef.setInput('source', { threadTitle: 'Péter Nagy', authorName: 'Péter Nagy', sentByMe: false, text: 'Péntekre megcsinálom.' });
    await fixture.whenStable();
    expect(element.querySelector('.quote p')?.textContent).toBe('“Péntekre megcsinálom.”');
    expect(element.querySelector('.quote footer')?.textContent).toContain('Péter Nagy · chat with Péter Nagy');
  });

  it('says when the commitment was added by hand', async () => {
    fixture.componentRef.setInput('source', null);
    await fixture.whenStable();
    expect(element.querySelector('.manual')?.textContent).toBe('Added manually');
  });
});
