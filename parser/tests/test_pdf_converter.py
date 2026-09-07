"""
Tests for pdf_to_image module.
"""

import sys
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from parser.pdf_to_image import PDFToImageConverter, pdf_to_images, pdf_to_png_bytes


@pytest.fixture
def sample_pdf_bytes():
    """Generate or load sample PDF bytes."""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas

        buffer = BytesIO()
        c = canvas.Canvas(buffer, pagesize=letter)
        c.drawString(100, 750, "Test PDF for converter")
        c.save()
        buffer.seek(0)
        return buffer.getvalue()
    except ImportError:
        path = Path(__file__).parent / "fixtures" / "sample.pdf"
        if not path.exists():
            pytest.skip("reportlab not installed and no sample.pdf")
        return path.read_bytes()


@pytest.fixture
def sample_pdf_multipage_bytes():
    """Generate or load multi-page PDF."""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfgen import canvas

        buffer = BytesIO()
        c = canvas.Canvas(buffer, pagesize=letter)
        for i in range(3):
            c.drawString(100, 750, f"Page {i+1}")
            c.showPage()
        c.save()
        buffer.seek(0)
        return buffer.getvalue()
    except ImportError:
        path = Path(__file__).parent / "fixtures" / "multipage.pdf"
        if not path.exists():
            pytest.skip("reportlab not installed and no multipage.pdf")
        return path.read_bytes()


@pytest.fixture
def converter():
    return PDFToImageConverter(dpi=100)


class TestPDFToImageConverter:
    """Test suite for PDFToImageConverter class."""

    def test_init_default(self):
        c = PDFToImageConverter()
        assert c.dpi == 150
        assert c.format == "png"
        assert c.scale == 150 / 72.0

    def test_init_custom(self):
        c = PDFToImageConverter(dpi=200, format="jpeg")
        assert c.dpi == 200
        assert c.format == "jpeg"
        assert c.scale == 200 / 72.0

    def test_pdf_bytes_to_images_success(self, converter, sample_pdf_bytes):
        images = converter.pdf_bytes_to_images(sample_pdf_bytes)

        assert isinstance(images, list)
        assert len(images) == 1
        assert isinstance(images[0], Image.Image)

        width, height = images[0].size
        assert width > 0
        assert height > 0
        assert images[0].mode == "RGB"

    def test_pdf_bytes_to_images_multipage(self, converter, sample_pdf_multipage_bytes):
        images = converter.pdf_bytes_to_images(sample_pdf_multipage_bytes)
        assert len(images) == 3

    def test_pdf_bytes_to_png_bytes(self, converter, sample_pdf_bytes):
        png_list = converter.pdf_bytes_to_png_bytes(sample_pdf_bytes)

        assert isinstance(png_list, list)
        assert len(png_list) == 1
        assert isinstance(png_list[0], bytes)
        assert len(png_list[0]) > 100
        assert png_list[0].startswith(b"\x89PNG")
        assert png_list[0][12:16] == b"IHDR"

    def test_pdf_bytes_to_single_png_bytes(self, converter, sample_pdf_bytes):
        png_bytes = converter.pdf_bytes_to_single_png_bytes(sample_pdf_bytes)
        assert isinstance(png_bytes, bytes)
        assert len(png_bytes) > 100
        assert png_bytes.startswith(b"\x89PNG")

    def test_dpi_effect(self, sample_pdf_bytes):
        converter_72 = PDFToImageConverter(dpi=72)
        converter_150 = PDFToImageConverter(dpi=150)

        images_72 = converter_72.pdf_bytes_to_images(sample_pdf_bytes)
        images_150 = converter_150.pdf_bytes_to_images(sample_pdf_bytes)

        size_72 = images_72[0].size
        size_150 = images_150[0].size

        assert size_150[0] > size_72[0]
        assert size_150[1] > size_72[1]
        ratio = size_150[0] / size_72[0]
        assert 1.9 < ratio < 2.2

    def test_empty_pdf_raises(self, converter):
        with pytest.raises(ValueError, match="PDF is empty"):
            converter.pdf_bytes_to_images(b"")

    def test_invalid_pdf_raises(self, converter):
        invalid_bytes = b"this is not a PDF file"
        with pytest.raises(ValueError, match="Cannot open PDF"):
            converter.pdf_bytes_to_images(invalid_bytes)

    def test_single_png_empty_raises(self, converter):
        with pytest.raises(ValueError, match="PDF is empty"):
            converter.pdf_bytes_to_single_png_bytes(b"")


class TestUtilityFunctions:
    """Test utility functions."""

    def test_pdf_to_images(self, sample_pdf_bytes):
        images = pdf_to_images(sample_pdf_bytes, dpi=100)
        assert isinstance(images, list)
        assert len(images) == 1
        assert isinstance(images[0], Image.Image)

    def test_pdf_to_png_bytes(self, sample_pdf_bytes):
        png_list = pdf_to_png_bytes(sample_pdf_bytes, dpi=100)
        assert isinstance(png_list, list)
        assert len(png_list) == 1
        assert isinstance(png_list[0], bytes)
        assert png_list[0].startswith(b"\x89PNG")


def test_with_real_file(tmp_path):
    """Integration test with a real PDF file (if available)."""
    path = Path(__file__).parent / "data" / "test.pdf"
    if not path.exists():
        pytest.skip("No file tests/data/test.pdf")
    pdf_bytes = path.read_bytes()
    converter = PDFToImageConverter(dpi=150)
    images = converter.pdf_bytes_to_images(pdf_bytes)
    assert len(images) > 0
    images[0].save(tmp_path / "test_output.png")
