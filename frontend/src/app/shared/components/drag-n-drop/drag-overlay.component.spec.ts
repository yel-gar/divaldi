import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { DragOverlayComponent } from './drag-overlay.component';
import { DragOverlayService } from './drag-overlay.service';

function fileDragEvent(type: string, files: File[] = []): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files, types: ['Files'] }
  });
  return event;
}

describe('DragOverlayComponent', () => {
  let fixture: ComponentFixture<DragOverlayComponent>;
  let overlay: DragOverlayService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DragOverlayComponent] }).compileComponents();
    overlay = TestBed.inject(DragOverlayService);
    fixture = TestBed.createComponent(DragOverlayComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('renders the backdrop only while a file drag is in progress', () => {
    expect(fixture.debugElement.query(By.css('.drag-overlay'))).toBeNull();

    document.dispatchEvent(fileDragEvent('dragenter', [new File(['x'], 'a.png')]));
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.drag-overlay'))).not.toBeNull();

    document.dispatchEvent(fileDragEvent('drop'));
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.drag-overlay'))).toBeNull();
  });

  it('hides the overlay when the drag leaves the document', () => {
    document.dispatchEvent(fileDragEvent('dragenter', [new File(['x'], 'a.png')]));
    fixture.detectChanges();

    document.dispatchEvent(fileDragEvent('dragleave'));
    fixture.detectChanges();

    expect(overlay.isVisible()).toBe(false);
    expect(fixture.debugElement.query(By.css('.drag-overlay'))).toBeNull();
  });

  it('emits dropped files and hides the overlay on drop', () => {
    const dropped: File[][] = [];
    fixture.componentInstance.filesDropped.subscribe((files) => dropped.push(files));
    const file = new File(['x'], 'a.png', { type: 'image/png' });

    document.dispatchEvent(fileDragEvent('dragenter', [file]));
    document.dispatchEvent(fileDragEvent('drop', [file]));
    fixture.detectChanges();

    expect(dropped).toEqual([[file]]);
    expect(overlay.isVisible()).toBe(false);
  });

  it('ignores drags without files', () => {
    const textDrag = new Event('dragenter', { bubbles: true });
    Object.defineProperty(textDrag, 'dataTransfer', { value: { types: ['text/plain'] } });

    document.dispatchEvent(textDrag);
    fixture.detectChanges();

    expect(overlay.isVisible()).toBe(false);
    expect(fixture.debugElement.query(By.css('.drag-overlay'))).toBeNull();
  });
});
