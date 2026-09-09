"""
PDF to image converter using PyMuPDF and Pillow.
"""

from io import BytesIO

import pymupdf as fitz
from PIL import Image


class PDFToImageConverter:
    """
    Converter class to transform PDF bytes into images or PNG bytes.
    """

    def __init__(self, dpi: int = 150, format: str = "png"):
        """
        Initialize the converter.

        Args:
            dpi: Resolution for rendering (dots per inch).
            format: Output image format (kept for compatibility, always saves PNG).
        """
        self.dpi = dpi
        self.format = format.lower()
        self.scale = dpi / 72.0

    def pdf_bytes_to_images(self, pdf_bytes: bytes) -> list[Image.Image]:
        """
        Convert PDF bytes to a list of PIL Image objects (one per page).

        Args:
            pdf_bytes: PDF file content as bytes.

        Returns:
            List of PIL.Image objects.

        Raises:
            ValueError: If PDF is empty, has no pages, or cannot be opened.
        """
        doc = None
        try:
            try:
                doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            except Exception as e:
                # Handle open errors: empty stream or corrupted PDF
                if len(pdf_bytes) == 0:
                    raise ValueError("PDF is empty") from e
                raise ValueError("Cannot open PDF") from e

            if doc.page_count == 0:
                raise ValueError("PDF is empty")

            images = []
            for page_num in range(doc.page_count):
                page = doc[page_num]
                pix = page.get_pixmap(matrix=fitz.Matrix(self.scale, self.scale))
                img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                images.append(img)
            return images
        finally:
            # Ensure document is closed even if an exception occurs
            if doc:
                doc.close()

    def pdf_bytes_to_png_bytes(self, pdf_bytes: bytes) -> list[bytes]:
        """
        Convert PDF bytes to a list of PNG bytes (one per page).

        Args:
            pdf_bytes: PDF file content as bytes.

        Returns:
            List of bytes, each representing a PNG image.
        """
        images = self.pdf_bytes_to_images(pdf_bytes)
        png_bytes_list = []

        for img in images:
            output = BytesIO()
            img.save(output, format="PNG")
            png_bytes_list.append(output.getvalue())
            output.close()  # Free the buffer

        return png_bytes_list

    def pdf_bytes_to_single_png_bytes(self, pdf_bytes: bytes) -> bytes:
        """
        Extract only the first page of the PDF and return it as PNG bytes.

        Args:
            pdf_bytes: PDF file content as bytes.

        Returns:
            PNG bytes of the first page.

        Raises:
            ValueError: If the PDF is empty or has no pages.
        """
        images = self.pdf_bytes_to_images(pdf_bytes)
        if not images:
            raise ValueError("No images to convert")

        output = BytesIO()
        images[0].save(output, format="PNG")
        result = output.getvalue()
        output.close()
        return result


# Convenience functions


def pdf_to_images(pdf_bytes: bytes, dpi: int = 150) -> list[Image.Image]:
    """Shortcut to convert PDF bytes to a list of images."""
    converter = PDFToImageConverter(dpi=dpi)
    return converter.pdf_bytes_to_images(pdf_bytes)


def pdf_to_png_bytes(pdf_bytes: bytes, dpi: int = 150) -> list[bytes]:
    """Shortcut to convert PDF bytes to a list of PNG bytes."""
    converter = PDFToImageConverter(dpi=dpi)
    return converter.pdf_bytes_to_png_bytes(pdf_bytes)
