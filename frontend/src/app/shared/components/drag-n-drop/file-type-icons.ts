import type { LucideIconData } from '@lucide/angular';

const mdiNode = (name: string, d: string): LucideIconData => ({
  name,
  node: [['path', { d, fill: 'currentColor', stroke: 'none' }]]
});

const FILE_PDF_BOX =
  'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m-9.5 8.5c0 .8-.7 1.5-1.5 1.5H7v2H5.5V9H8c.8 0 1.5.7 1.5 1.5zm5 2c0 .8-.7 1.5-1.5 1.5h-2.5V9H13c.8 0 1.5.7 1.5 1.5zm4-3H17v1h1.5V13H17v2h-1.5V9h3zm-6.5 0h1v3h-1zm-5 0h1v1H7z';

const FILE_WORD_BOX =
  'M15.5 17H14l-2-7.5l-2 7.5H8.5L6.1 7h1.7l1.54 7.5L11.3 7h1.4l1.97 7.5L16.2 7h1.7M19 3H5c-1.11 0-2 .89-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2';

const FILE_EXCEL_BOX =
  'M16.2 17h-2L12 13.2L9.8 17h-2l3.2-5l-3.2-5h2l2.2 3.8L14.2 7h2L13 12m6-9H5c-1.11 0-2 .89-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2';

const FILE_IMAGE_BOX =
  'M8.5 13.498l2.5 3.006l3.5-4.506l4.5 6H5m16 1v-14a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2z';

const FILE_CAD_BOX =
  'M5 3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2m-7.75 2.25h1.5v1.13c.83 0 1.5.67 1.5 1.5v2.49l-.14.13l1.07 1.86c.37-.6.57-1.29.57-2h1.5A5.2 5.2 0 0 1 16 13.77l2 3.48v1.5L16.7 18l-1.86-3.22a5.18 5.18 0 0 1-5.68 0L7.3 18l-1.3.75v-1.5l3.89-6.75l-.14-.13V7.88c0-.83.67-1.5 1.5-1.5m.75 1.5c-.84 0-1.26 1.02-.66 1.62A.943.943 0 1 0 12 7.88m-1 3.72l-1.09 1.9c1.26.86 2.92.86 4.18 0L13 11.6c-.57.51-1.43.51-2 0';

export const FILE_TYPE_PDF = mdiNode('file-pdf-box', FILE_PDF_BOX);

export const FILE_TYPE_WORD = mdiNode('file-word-box', FILE_WORD_BOX);

export const FILE_TYPE_EXCEL = mdiNode('file-excel-box', FILE_EXCEL_BOX);

export const FILE_TYPE_IMAGE = mdiNode('file-image-box', FILE_IMAGE_BOX);

export const FILE_TYPE_CAD = mdiNode('file-cad-box', FILE_CAD_BOX);
