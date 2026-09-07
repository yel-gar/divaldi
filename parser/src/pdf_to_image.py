from typing import List
from io import BytesIO
from PIL import Image
import pymupdf as fitz


class PDFToImageConverter:

    def __init__(self, dpi: int = 150, format: str = "png"):
        self.dpi = dpi
        self.format = format.lower()
        self.scale = dpi / 72.0

    def pdf_bytes_to_images(self, pdf_bytes: bytes) -> List[Image.Image]:
        if not pdf_bytes:
            raise ValueError("PDF is empty")

        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        except Exception as e:
            raise ValueError(f"Cannot open PDF: {e}")

        if doc.page_count == 0:
            doc.close()
            raise ValueError("PDF is empty")

        images = []
        for page_num in range(doc.page_count):
            page = doc[page_num]
            pix = page.get_pixmap(matrix=fitz.Matrix(self.scale, self.scale))
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            images.append(img)

        doc.close()
        return images

    def pdf_bytes_to_png_bytes(self, pdf_bytes: bytes) -> List[bytes]:
        images = self.pdf_bytes_to_images(pdf_bytes)
        png_bytes_list = []

        for img in images:
            output = BytesIO()
            img.save(output, format="PNG")
            png_bytes_list.append(output.getvalue())
            output.close()

        return png_bytes_list

    def pdf_bytes_to_single_png_bytes(self, pdf_bytes: bytes) -> bytes:
        images = self.pdf_bytes_to_images(pdf_bytes)
        if not images:
            raise ValueError("No images to convert")

        output = BytesIO()
        images[0].save(output, format="PNG")
        result = output.getvalue()
        output.close()
        return result


def pdf_to_images(pdf_bytes: bytes, dpi: int = 150) -> List[Image.Image]:
    converter = PDFToImageConverter(dpi=dpi)
    return converter.pdf_bytes_to_images(pdf_bytes)


def pdf_to_png_bytes(pdf_bytes: bytes, dpi: int = 150) -> List[bytes]:
    converter = PDFToImageConverter(dpi=dpi)
    return converter.pdf_bytes_to_png_bytes(pdf_bytes)
