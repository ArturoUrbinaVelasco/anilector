#!/usr/bin/env python3
"""Fixtures para probar el visor sin depender de internet ni de apt/pip.

  fx/prueba.pdf   — 3 páginas CON índice (/Outlines), para probar el TOC
  fx/prueba.epub  — EPUB 2 de 3 capítulos con NCX, para el TOC y el progreso
"""
import os, zipfile

# La carpeta `fx/` cuelga del repositorio, esté donde esté clonado.
FX = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fx")
os.makedirs(FX, exist_ok=True)


def armar_pdf(objs):
    """objs: lista de bytes (el objeto n es objs[n-1]). Devuelve el PDF."""
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += str(i).encode() + b" 0 obj\n" + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 " + str(len(objs) + 1).encode() + b"\n0000000000 65535 f \n"
    for off in offsets:
        out += ("%010d 00000 n \n" % off).encode()
    out += (b"trailer\n<< /Size " + str(len(objs) + 1).encode() +
            b" /Root 1 0 R >>\nstartxref\n" + str(xref).encode() + b"\n%%EOF\n")
    return bytes(out)


def make_pdf(path):
    titulos = ["Capitulo uno", "Capitulo dos", "Capitulo tres"]
    contenidos = []
    for i, tit in enumerate(titulos, 1):
        s = (f"BT /F1 22 Tf 40 140 Td ({tit}) Tj ET "
             f"BT /F1 14 Tf 40 100 Td (Pagina {i} de prueba AniLector) Tj ET").encode()
        contenidos.append(b"<< /Length " + str(len(s)).encode() + b" >>\nstream\n" + s + b"\nendstream")

    # 1 catálogo · 2 pages · 3-5 páginas · 6 outlines · 7-9 contenidos ·
    # 10 fuente · 11-13 entradas del índice
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R /PageMode /UseOutlines >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
    ]
    for i in range(3):
        objs.append(
            ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] "
             f"/Contents {7 + i} 0 R /Resources << /Font << /F1 10 0 R >> >> >>").encode())
    objs.append(b"<< /Type /Outlines /First 11 0 R /Last 13 0 R /Count 3 >>")
    objs.extend(contenidos)
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for i, tit in enumerate(titulos):
        n = 11 + i
        partes = [f"/Title ({tit})", "/Parent 6 0 R", f"/Dest [{3 + i} 0 R /Fit]"]
        if i > 0:
            partes.append(f"/Prev {n - 1} 0 R")
        if i < 2:
            partes.append(f"/Next {n + 1} 0 R")
        objs.append(("<< " + " ".join(partes) + " >>").encode())

    with open(path, "wb") as f:
        f.write(armar_pdf(objs))


def make_epub(path):
    caps = [("cap1", "Capitulo uno", "Hola AniLector EPUB"),
            ("cap2", "Capitulo dos", "Segundo capitulo de prueba"),
            ("cap3", "Capitulo tres", "Tercer capitulo de prueba")]

    container = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"""

    items = "\n    ".join(
        f'<item id="{i}" href="{i}.xhtml" media-type="application/xhtml+xml"/>' for i, _, _ in caps)
    spine = "".join(f'<itemref idref="{i}"/>' for i, _, _ in caps)
    opf = f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:anilector-fixture-0001</dc:identifier>
    <dc:title>Prueba AniLector</dc:title>
    <dc:language>es</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    {items}
  </manifest>
  <spine toc="ncx">{spine}</spine>
</package>"""

    navpoints = "\n    ".join(
        f'<navPoint id="n{k+1}" playOrder="{k+1}"><navLabel><text>{tit}</text></navLabel>'
        f'<content src="{i}.xhtml"/></navPoint>' for k, (i, tit, _) in enumerate(caps))
    ncx = f"""<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:anilector-fixture-0001"/></head>
  <docTitle><text>Prueba AniLector</text></docTitle>
  <navMap>
    {navpoints}
  </navMap>
</ncx>"""

    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container, zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/content.opf", opf, zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/toc.ncx", ncx, zipfile.ZIP_DEFLATED)
        for i, tit, texto in caps:
            cap = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{tit}</title></head>
<body><h1>{tit}</h1><p>{texto}. Texto suficientemente largo para que el detector
de idioma tenga con que trabajar y para que la pagina tenga contenido real.</p></body></html>"""
            z.writestr(f"OEBPS/{i}.xhtml", cap, zipfile.ZIP_DEFLATED)


def make_epub_grande(path, n_caps=30):
    """EPUB de 30 capítulos con texto de relleno.

    IMPRESCINDIBLE para todo lo relacionado con el progreso: con el EPUB
    de 3 capítulos el porcentaje parecía funcionar (0/50/100) y escondía
    el fallo real de «siempre 0%». Aquí `locations.generate()` tarda
    segundos, que es justo la situación que hay que probar.
    """
    relleno = ("Este es un parrafo de relleno con suficiente texto como para que el libro "
               "tenga un tamano realista y el calculo de posiciones tarde lo que tarda "
               "en un libro de verdad. ")
    caps = [(f"c{i:02d}", f"Capitulo {i}") for i in range(1, n_caps + 1)]

    items = "\n    ".join(
        f'<item id="{i}" href="{i}.xhtml" media-type="application/xhtml+xml"/>' for i, _ in caps)
    spine = "".join(f'<itemref idref="{i}"/>' for i, _ in caps)
    navpoints = "\n    ".join(
        f'<navPoint id="n{k+1}" playOrder="{k+1}"><navLabel><text>{tit}</text></navLabel>'
        f'<content src="{i}.xhtml"/></navPoint>' for k, (i, tit) in enumerate(caps))

    opf = f"""<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:anilector-grande-0001</dc:identifier>
    <dc:title>Libro grande</dc:title><dc:language>es</dc:language>
  </metadata>
  <manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    {items}</manifest>
  <spine toc="ncx">{spine}</spine>
</package>"""
    ncx = f"""<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:anilector-grande-0001"/></head>
  <docTitle><text>Libro grande</text></docTitle>
  <navMap>
    {navpoints}</navMap>
</ncx>"""
    container = """<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"""

    with zipfile.ZipFile(path, "w") as z:
        z.writestr(zipfile.ZipInfo("mimetype"), "application/epub+zip", zipfile.ZIP_STORED)
        z.writestr("META-INF/container.xml", container, zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/content.opf", opf, zipfile.ZIP_DEFLATED)
        z.writestr("OEBPS/toc.ncx", ncx, zipfile.ZIP_DEFLATED)
        for i, tit in caps:
            cuerpo = "".join(f"<p>{relleno * 6}</p>" for _ in range(12))
            z.writestr(f"OEBPS/{i}.xhtml", f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>{tit}</title></head>
<body><h1>{tit}</h1>{cuerpo}</body></html>""", zipfile.ZIP_DEFLATED)


def make_pdf_buscable(path, paginas=4):
    """PDF con texto de verdad en varias páginas, para probar la búsqueda.
    Lleva una palabra con tilde (murciélago) escrita en Latin-1, que es como
    la codifica la fuente Helvetica estándar: así se prueba que buscar sin
    tildes encuentra igual."""
    lineas = [
        "El murcielago vuela de noche sobre la ciudad dormida.",
        "Nadie recuerda cuando llego el murcielago por primera vez.",
        "En el tercer piso alguien dejo la ventana abierta.",
        "El murcielago encontro por fin un sitio donde descansar.",
    ]
    contenidos = []
    for i in range(paginas):
        texto = lineas[i % len(lineas)]
        s = (f"BT /F1 16 Tf 40 150 Td (Pagina {i + 1}) Tj ET "
             f"BT /F1 12 Tf 40 110 Td ({texto}) Tj ET").encode("latin-1")
        contenidos.append(b"<< /Length " + str(len(s)).encode() + b" >>\nstream\n" + s + b"\nendstream")

    primera_pagina = 3
    primer_contenido = primera_pagina + paginas
    fuente = primer_contenido + paginas
    kids = " ".join(f"{primera_pagina + i} 0 R" for i in range(paginas))
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        (f"<< /Type /Pages /Kids [{kids}] /Count {paginas} >>").encode(),
    ]
    for i in range(paginas):
        objs.append(
            ("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 200] "
             f"/Contents {primer_contenido + i} 0 R "
             f"/Resources << /Font << /F1 {fuente} 0 R >> >> >>").encode())
    objs.extend(contenidos)
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    with open(path, "wb") as f:
        f.write(armar_pdf(objs))


def make_pdf_escaneado(path):
    """Un PDF SIN nada de texto: solo un rectángulo dibujado, como la foto
    de una página. Es lo que hay que distinguir de «la palabra no está»."""
    s = b"0.9 0.9 0.85 rg 20 20 360 160 re f 0.2 0.2 0.2 rg 40 40 80 30 re f"
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << >> >>",
        b"<< /Length " + str(len(s)).encode() + b" >>\nstream\n" + s + b"\nendstream",
    ]
    with open(path, "wb") as f:
        f.write(armar_pdf(objs))


def make_cbz(path, paginas=3):
    """Un cómic: un ZIP con imágenes PNG mínimas."""
    import zipfile, struct, zlib

    def png(ancho, alto, color):
        def trozo(tipo, datos):
            c = tipo + datos
            return struct.pack(">I", len(datos)) + c + struct.pack(">I", zlib.crc32(c))
        cabecera = struct.pack(">IIBBBBB", ancho, alto, 8, 2, 0, 0, 0)
        crudo = b"".join(b"\x00" + bytes(color) * ancho for _ in range(alto))
        return (b"\x89PNG\r\n\x1a\n" + trozo(b"IHDR", cabecera) +
                trozo(b"IDAT", zlib.compress(crudo)) + trozo(b"IEND", b""))

    with zipfile.ZipFile(path, "w") as z:
        for i in range(paginas):
            z.writestr(f"{i + 1:03d}.png", png(60, 90, (40 + i * 60, 80, 160)))


def make_pdf_otro(path):
    """Otro PDF, DISTINTO de prueba.pdf pero que en las pruebas se abre con
    el mismo nombre. Sirve para comprobar que la huella del contenido los
    separa: antes compartían el punto de lectura porque la clave era el
    título, y dos «Documento1» se pisaban."""
    s = (b"BT /F1 18 Tf 40 140 Td (Otro documento distinto) Tj ET "
         b"BT /F1 12 Tf 40 100 Td (Con otro contenido, aunque se llame igual) Tj ET")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(s)).encode() + b" >>\nstream\n" + s + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    with open(path, "wb") as f:
        f.write(armar_pdf(objs))


make_pdf(os.path.join(FX, "prueba.pdf"))
make_pdf_otro(os.path.join(FX, "otro.pdf"))
make_pdf_buscable(os.path.join(FX, "buscable.pdf"))
make_pdf_escaneado(os.path.join(FX, "escaneado.pdf"))
make_cbz(os.path.join(FX, "comic.cbz"))
make_epub(os.path.join(FX, "prueba.epub"))
make_epub_grande(os.path.join(FX, "grande.epub"))
print("fixtures listos:", sorted(os.listdir(FX)))
