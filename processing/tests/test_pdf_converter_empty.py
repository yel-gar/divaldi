"""
Coverage for the PDF converter's failure paths.

Two of them cannot be produced with a real file and are therefore driven with a
stand-in for PyMuPDF's document:

* ``page_count == 0`` on a document that *opened* successfully. PyMuPDF rejects a
  genuinely empty stream earlier, so this state is only reachable through a
  document object that reports no pages.
* ``pdf_bytes_to_png_bytes`` finding no images after a successful conversion.
"""

import pytest

from processing.parser import pdf_to_image
from processing.parser.pdf_to_image import PDFToImageConverter


class _EmptyDoc:
    """A document PyMuPDF would accept but that contains no pages."""

    page_count = 0
    closed = False

    def close(self):
        self.closed = True


class _ZeroPageFitZ:
    """Stands in for the ``pymupdf`` module, returning a page-less document."""

    @staticmethod
    def open(stream, filetype):  # noqa: ARG004 - mirrors the real signature
        return _EmptyDoc()


def test_pdf_bytes_to_images_rejects_a_document_with_no_pages(monkeypatch):
    """A document that opens but has no pages is still an empty PDF."""
    monkeypatch.setattr(pdf_to_image, "fitz", _ZeroPageFitZ)

    with pytest.raises(ValueError, match="PDF is empty"):
        PDFToImageConverter().pdf_bytes_to_images(b"%PDF-1.4")


def test_a_page_less_document_is_still_closed(monkeypatch):
    """The ``finally`` block must close the document even on the failure path."""
    monkeypatch.setattr(pdf_to_image, "fitz", _ZeroPageFitZ)
    captured = {}

    original_open = _ZeroPageFitZ.open

    def open_and_record(stream, filetype):
        doc = original_open(stream, filetype)
        captured["doc"] = doc
        return doc

    monkeypatch.setattr(_ZeroPageFitZ, "open", staticmethod(open_and_record))

    with pytest.raises(ValueError, match="PDF is empty"):
        PDFToImageConverter().pdf_bytes_to_images(b"%PDF-1.4")

    assert captured["doc"].closed is True


def test_pdf_bytes_to_single_png_bytes_requires_at_least_one_image(monkeypatch):
    """Converting to a single PNG cannot pick a first page when there are none."""

    def no_images(self, pdf_bytes):
        return []

    monkeypatch.setattr(PDFToImageConverter, "pdf_bytes_to_images", no_images)

    with pytest.raises(ValueError, match="No images to convert"):
        PDFToImageConverter().pdf_bytes_to_single_png_bytes(b"%PDF-1.4")


def test_convenience_function_wraps_the_converter(monkeypatch):
    """The module-level shortcut must not swallow the empty-document error."""
    monkeypatch.setattr(pdf_to_image, "fitz", _ZeroPageFitZ)

    with pytest.raises(ValueError, match="PDF is empty"):
        pdf_to_image.pdf_to_images(b"%PDF-1.4")


def test_single_png_shortcut_wraps_the_converter(monkeypatch):
    """``pdf_to_png_bytes`` inherits the same guard as the class method."""
    monkeypatch.setattr(pdf_to_image, "fitz", _ZeroPageFitZ)

    with pytest.raises(ValueError, match="PDF is empty"):
        pdf_to_image.pdf_to_png_bytes(b"%PDF-1.4")
