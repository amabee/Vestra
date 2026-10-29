# Focused manga reader

Opening a book now fills the app below the window title bar. A compact header keeps
the book, current chapter, chapter navigation and Library exit accessible without
the catalogue masthead or source chooser taking space above the image.

The Chapters drawer contains chapter search, language and scanlator filters and the
current chapter highlight. It occupies a column on wider windows and overlays the
canvas on narrow windows. Reading settings open separately over the canvas and can
be closed with Escape. The footer keeps page navigation, page jump, chapter-end
navigation and a progress strip visible.

Fit height uses a ResizeObserver on the actual image canvas, accounting for the
toolbar and window size. Single/double pages, reading direction, zoom, remembered
preferences, image retries and decode-before-progress-save behavior remain in use.

Background validation: TypeScript checks, production build and five existing reader
navigation cases. Desktop visual inspection, window resizing and real chapter
interaction remain for user testing; no desktop windows were opened for this work.
