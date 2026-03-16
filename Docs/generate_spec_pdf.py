#!/usr/bin/env python3
"""Generate a professional PDF of the AES6 W&F SPA Architecture Spec."""

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, Preformatted, KeepTogether, HRFlowable, Flowable
)
from reportlab.lib import colors
from reportlab.pdfbase.pdfmetrics import stringWidth
import re
import os

SPEC_PATH = os.path.join(os.path.dirname(__file__), "spa_architecture_spec.md")
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "spa_architecture_spec.pdf")

# Colors
DARK_BLUE = HexColor("#1a237e")
MED_BLUE = HexColor("#283593")
LIGHT_BLUE = HexColor("#e8eaf6")
CODE_BG = HexColor("#f5f5f5")
HEADER_BG = HexColor("#e3f2fd")
TABLE_HEADER_BG = HexColor("#1565c0")
TABLE_ALT_ROW = HexColor("#f5f5f5")
RULE_COLOR = HexColor("#bdbdbd")


def build_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        'DocTitle', parent=styles['Title'],
        fontSize=22, leading=28, textColor=DARK_BLUE,
        spaceAfter=6, alignment=TA_LEFT
    ))
    styles.add(ParagraphStyle(
        'DocSubtitle', parent=styles['Normal'],
        fontSize=12, leading=16, textColor=HexColor("#555555"),
        spaceAfter=20
    ))
    styles.add(ParagraphStyle(
        'H2', parent=styles['Heading2'],
        fontSize=16, leading=20, textColor=DARK_BLUE,
        spaceBefore=18, spaceAfter=8,
        borderWidth=0, borderPadding=0,
    ))
    styles.add(ParagraphStyle(
        'H3', parent=styles['Heading3'],
        fontSize=13, leading=17, textColor=MED_BLUE,
        spaceBefore=12, spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        'Body', parent=styles['Normal'],
        fontSize=10, leading=14, spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        'BodyBold', parent=styles['Normal'],
        fontSize=10, leading=14, spaceAfter=6,
        fontName='Helvetica-Bold',
    ))
    styles.add(ParagraphStyle(
        'BulletItem', parent=styles['Normal'],
        fontSize=10, leading=14, spaceAfter=3,
        leftIndent=20, bulletIndent=8,
        bulletFontName='Helvetica', bulletFontSize=10,
    ))
    styles.add(ParagraphStyle(
        'BulletNested', parent=styles['Normal'],
        fontSize=10, leading=14, spaceAfter=3,
        leftIndent=40, bulletIndent=28,
        bulletFontName='Helvetica', bulletFontSize=10,
    ))
    styles.add(ParagraphStyle(
        'NumberedItem', parent=styles['Normal'],
        fontSize=10, leading=14, spaceAfter=3,
        leftIndent=20, bulletIndent=8,
    ))
    styles.add(ParagraphStyle(
        'CodeBlock', parent=styles['Code'],
        fontSize=8, leading=11, fontName='Courier',
        leftIndent=12, rightIndent=12,
        spaceBefore=4, spaceAfter=4,
        backColor=CODE_BG,
    ))
    styles.add(ParagraphStyle(
        'TableCell', parent=styles['Normal'],
        fontSize=9, leading=12,
    ))
    styles.add(ParagraphStyle(
        'TableHeader', parent=styles['Normal'],
        fontSize=9, leading=12, fontName='Helvetica-Bold',
        textColor=white,
    ))
    styles.add(ParagraphStyle(
        'FutureNote', parent=styles['Normal'],
        fontSize=10, leading=14, spaceAfter=6,
        textColor=HexColor("#37474f"),
        backColor=HexColor("#fff3e0"),
        borderWidth=1, borderColor=HexColor("#ffb74d"),
        borderPadding=6,
    ))
    return styles


def fix_fractions(text):
    """Replace Unicode fraction characters with ASCII equivalents for Helvetica."""
    replacements = {
        '⅓': '-1/3',
        '⅔': '-2/3',
        '⅛': '-1/8',
        '⅜': '-3/8',
        '⅝': '-5/8',
        '⅞': '-7/8',
        '¼': '-1/4',
        '¾': '-3/4',
        '½': '-1/2',
        '√': 'sqrt',
    }
    for frac, repl in replacements.items():
        text = text.replace(frac, repl)
    return text


class DataFlowDiagram(Flowable):
    """Custom flowable that draws the data flow as a professional box-and-arrow diagram."""

    # Stage definitions: (title, subtitle, color, items)
    STAGES = [
        (
            "File Input (JS)", None, HexColor("#1565c0"),
            [
                "Drag-drop / click-browse / URL param",
                "FLAC: WASM decode to PCM",
                "WAV: FileReader to Uint8Array",
            ]
        ),
        (
            "Pre-processing (JS)", None, HexColor("#00838f"),
            [
                "Sample rate check (44.1 kHz minimum)",
                "Quick FFT carrier detection (dominant spectral peak)",
                "Adaptive downsample via OfflineAudioContext",
                "Non-signal trimming (RMS threshold)",
                "Duration cap enforcement (120s)",
            ]
        ),
        (
            "Python Pipeline", "PyScript / Pyodide — full file, one call", HexColor("#2e7d32"),
            [
                "Carrier detection (own FFT — stands on its own)",
                "Bandpass prefilter (auto-tuned, cached)",
                "Zero-crossing detection (sinc interp + Brent's)",
                "Per-cycle frequency extraction",
                "Edge trimming + outlier rejection",
                "Uniform grid interpolation",
                "AES6 weighting + band separation",
                "Returns structured data (not images)",
            ]
        ),
        (
            "JS Rendering", None, HexColor("#6a1b9a"),
            [
                "Deviation waveform (interactive, zoomable)",
                "Spectrum with selectable harmonics",
                "Stats panel (AES6 metrics)",
                "Polar plot (optional)",
                "Histogram (optional)",
            ]
        ),
    ]

    # Connector labels between stages
    CONNECTORS = [
        None,  # before first stage
        None,  # between 1 and 2
        "downsampled PCM",  # between 2 and 3
        None,  # between 3 and 4
    ]

    def __init__(self, width):
        Flowable.__init__(self)
        self.width = width
        self._calc_height()

    def _calc_height(self):
        """Pre-calculate total height."""
        self._stage_heights = []
        for title, subtitle, color, items in self.STAGES:
            h = 28  # title bar height
            if subtitle:
                h += 14
            h += 6  # top padding in body
            h += len(items) * 14  # items
            h += 8  # bottom padding
            self._stage_heights.append(h)

        arrow_h = 28  # space between boxes (arrow zone)
        total = sum(self._stage_heights) + arrow_h * (len(self.STAGES) - 1)
        self.height = total

    def wrap(self, availWidth, availHeight):
        return (self.width, self.height)

    def draw(self):
        c = self.canv
        box_width = self.width * 0.75
        x_offset = (self.width - box_width) / 2
        arrow_gap = 28
        bullet_col = HexColor("#666666")

        y = self.height  # start from top

        for idx, (title, subtitle, color, items) in enumerate(self.STAGES):
            box_h = self._stage_heights[idx]
            box_top = y
            box_bottom = y - box_h

            # Draw box shadow
            c.setFillColor(HexColor("#e0e0e0"))
            c.roundRect(x_offset + 2, box_bottom - 2, box_width, box_h, 6, fill=1, stroke=0)

            # Draw box background
            c.setFillColor(white)
            c.setStrokeColor(color)
            c.setLineWidth(1.5)
            c.roundRect(x_offset, box_bottom, box_width, box_h, 6, fill=1, stroke=1)

            # Title bar
            title_bar_h = 24
            c.setFillColor(color)
            # Top rounded rect for title bar — draw a clipped rectangle
            c.saveState()
            p = c.beginPath()
            r = 6
            tb_top = box_top
            tb_bottom = box_top - title_bar_h
            p.moveTo(x_offset, tb_bottom)
            p.lineTo(x_offset, tb_top - r)
            p.arcTo(x_offset, tb_top - 2 * r, x_offset + 2 * r, tb_top, 90, 90)
            p.lineTo(x_offset + box_width - r, tb_top)
            p.arcTo(x_offset + box_width - 2 * r, tb_top - 2 * r, x_offset + box_width, tb_top, 0, 90)
            p.lineTo(x_offset + box_width, tb_bottom)
            p.close()
            c.clipPath(p, stroke=0)
            c.rect(x_offset, tb_bottom, box_width, title_bar_h, fill=1, stroke=0)
            c.restoreState()

            # Title text
            c.setFillColor(white)
            c.setFont('Helvetica-Bold', 11)
            c.drawString(x_offset + 12, box_top - 16, title)

            # Subtitle
            text_y = box_top - title_bar_h
            if subtitle:
                text_y -= 14
                c.setFillColor(HexColor("#666666"))
                c.setFont('Helvetica-Oblique', 8)
                c.drawString(x_offset + 12, text_y + 2, subtitle)

            # Items
            text_y -= 8
            c.setFont('Helvetica', 9)
            for item in items:
                text_y -= 14
                # Bullet
                c.setFillColor(color)
                c.circle(x_offset + 18, text_y + 3, 2, fill=1, stroke=0)
                # Text
                c.setFillColor(HexColor("#333333"))
                c.drawString(x_offset + 26, text_y, item)

            y = box_bottom

            # Draw arrow to next stage
            if idx < len(self.STAGES) - 1:
                arrow_x = self.width / 2
                arrow_top = y
                arrow_bottom = y - arrow_gap

                # Connector label
                connector_label = self.CONNECTORS[idx + 1] if idx + 1 < len(self.CONNECTORS) else None

                # Arrow shaft
                c.setStrokeColor(HexColor("#9e9e9e"))
                c.setLineWidth(2)
                c.line(arrow_x, arrow_top, arrow_x, arrow_bottom + 8)

                # Arrowhead
                c.setFillColor(HexColor("#9e9e9e"))
                p = c.beginPath()
                p.moveTo(arrow_x - 6, arrow_bottom + 8)
                p.lineTo(arrow_x, arrow_bottom)
                p.lineTo(arrow_x + 6, arrow_bottom + 8)
                p.close()
                c.drawPath(p, fill=1, stroke=0)

                # Connector label (to the right of the arrow)
                if connector_label:
                    c.setFillColor(HexColor("#888888"))
                    c.setFont('Helvetica-Oblique', 8)
                    c.drawString(arrow_x + 12, arrow_top - arrow_gap / 2 - 3, connector_label)

                y = arrow_bottom


def is_dataflow_codeblock(content):
    """Detect if a code block is the data flow diagram."""
    return 'File Input (JS)' in content and 'JS Rendering' in content


def fmt(text):
    """Convert markdown inline formatting to reportlab XML."""
    # Replace Unicode fractions before any other processing
    text = fix_fractions(text)
    # Unescape markdown pipe escapes (used inside tables)
    text = text.replace('\\|', '|')
    # Bold
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    # Inline code
    text = re.sub(r'`([^`]+)`', r'<font face="Courier" size="9">\1</font>', text)
    # Escape < that aren't part of our XML tags (b, font, etc.)
    # First protect our tags, then escape remaining <
    text = re.sub(r'<(?!/?(?:b|font|i|u|super|sub|br/)[ >])', '&lt;', text)
    return text


def parse_table_row(line):
    """Parse a markdown table row, respecting backtick-quoted content that may contain pipes."""
    # Strip leading/trailing pipe and whitespace
    line = line.strip()
    if line.startswith('|'):
        line = line[1:]
    if line.endswith('|'):
        line = line[:-1]

    # Split on pipes that are NOT inside backticks
    cells = []
    current = []
    in_backtick = False
    for ch in line:
        if ch == '`':
            in_backtick = not in_backtick
            current.append(ch)
        elif ch == '|' and not in_backtick:
            cells.append(''.join(current).strip())
            current = []
        else:
            current.append(ch)
    cells.append(''.join(current).strip())
    return [c for c in cells if c != '' or len(cells) <= 2]


def parse_markdown(md_text):
    """Parse the markdown into a list of structured blocks."""
    lines = md_text.split('\n')
    blocks = []
    i = 0
    while i < len(lines):
        line = lines[i]

        # Headings
        if line.startswith('# ') and not line.startswith('## '):
            blocks.append(('h1', line[2:].strip()))
            i += 1
            continue
        if line.startswith('## ') and not line.startswith('### '):
            blocks.append(('h2', line[3:].strip()))
            i += 1
            continue
        if line.startswith('### '):
            blocks.append(('h3', line[4:].strip()))
            i += 1
            continue

        # Horizontal rule
        if line.strip() == '---':
            blocks.append(('hr', ''))
            i += 1
            continue

        # Code block
        if line.strip().startswith('```'):
            lang = line.strip()[3:]
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing ```
            blocks.append(('code', '\n'.join(code_lines)))
            continue

        # Table
        if '|' in line and i + 1 < len(lines) and '---' in lines[i + 1]:
            table_lines = []
            while i < len(lines) and '|' in lines[i]:
                if '---' not in lines[i]:
                    cells = parse_table_row(lines[i])
                    table_lines.append(cells)
                i += 1
            blocks.append(('table', table_lines))
            continue

        # Numbered list
        if re.match(r'^\d+\.\s', line.strip()):
            items = []
            while i < len(lines) and re.match(r'^\d+\.\s', lines[i].strip()):
                item_text = re.sub(r'^\d+\.\s+', '', lines[i].strip())
                items.append(item_text)
                i += 1
            blocks.append(('ol', items))
            continue

        # Bullet list
        if line.strip().startswith('- '):
            items = []
            while i < len(lines) and (lines[i].strip().startswith('- ') or lines[i].strip().startswith('  - ')):
                if lines[i].strip().startswith('  - '):
                    items.append(('nested', lines[i].strip()[2:].strip()))
                else:
                    items.append(('top', lines[i].strip()[2:].strip()))
                i += 1
            blocks.append(('ul', items))
            continue

        # Blank line
        if line.strip() == '':
            i += 1
            continue

        # Regular paragraph
        para_lines = []
        while i < len(lines) and lines[i].strip() != '' and not lines[i].startswith('#') and not lines[i].startswith('```') and not lines[i].strip().startswith('- ') and not re.match(r'^\d+\.\s', lines[i].strip()) and lines[i].strip() != '---' and not ('|' in lines[i] and i + 1 < len(lines) and '---' in lines[i + 1]):
            para_lines.append(lines[i])
            i += 1
        if para_lines:
            blocks.append(('para', ' '.join(para_lines)))

    return blocks


def build_pdf(blocks, styles):
    story = []

    for btype, content in blocks:
        if btype == 'h1':
            story.append(Paragraph(fmt(content), styles['DocTitle']))
            story.append(HRFlowable(
                width="100%", thickness=2, color=DARK_BLUE,
                spaceAfter=12
            ))

        elif btype == 'h2':
            story.append(Spacer(1, 6))
            story.append(HRFlowable(
                width="100%", thickness=0.5, color=RULE_COLOR,
                spaceAfter=2
            ))
            story.append(Paragraph(fmt(content), styles['H2']))

        elif btype == 'h3':
            story.append(Paragraph(fmt(content), styles['H3']))

        elif btype == 'hr':
            pass  # h2 already has a rule

        elif btype == 'code':
            if is_dataflow_codeblock(content):
                # Render as a professional diagram instead of code block
                story.append(Spacer(1, 8))
                story.append(DataFlowDiagram(width=6.5 * inch))
                story.append(Spacer(1, 8))
            else:
                # Wrap in a light background box
                code_text = fix_fractions(content)
                code_text = code_text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
                code_text = code_text.replace('\t', '    ')
                story.append(Spacer(1, 4))
                story.append(Preformatted(code_text, styles['CodeBlock']))
                story.append(Spacer(1, 4))

        elif btype == 'table':
            if len(content) < 1:
                continue
            headers = content[0]
            rows = content[1:]
            col_count = len(headers)

            # Build table data with Paragraphs
            table_data = []
            header_row = [Paragraph(fmt(h), styles['TableHeader']) for h in headers]
            table_data.append(header_row)
            for row in rows:
                # Pad row if needed
                while len(row) < col_count:
                    row.append('')
                table_data.append([Paragraph(fmt(c), styles['TableCell']) for c in row[:col_count]])

            # Calculate column widths
            avail_width = 6.5 * inch
            col_widths = [avail_width / col_count] * col_count

            # For 2-column tables, use 30/70 split
            if col_count == 2:
                col_widths = [avail_width * 0.3, avail_width * 0.7]
            elif col_count == 3:
                col_widths = [avail_width * 0.28, avail_width * 0.22, avail_width * 0.50]

            t = Table(table_data, colWidths=col_widths, repeatRows=1)
            style_cmds = [
                ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER_BG),
                ('TEXTCOLOR', (0, 0), (-1, 0), white),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 9),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 6),
                ('TOPPADDING', (0, 0), (-1, 0), 6),
                ('GRID', (0, 0), (-1, -1), 0.5, HexColor("#e0e0e0")),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('LEFTPADDING', (0, 0), (-1, -1), 6),
                ('RIGHTPADDING', (0, 0), (-1, -1), 6),
                ('TOPPADDING', (0, 1), (-1, -1), 4),
                ('BOTTOMPADDING', (0, 1), (-1, -1), 4),
            ]
            # Alternating row colors
            for row_idx in range(1, len(table_data)):
                if row_idx % 2 == 0:
                    style_cmds.append(('BACKGROUND', (0, row_idx), (-1, row_idx), TABLE_ALT_ROW))

            t.setStyle(TableStyle(style_cmds))
            story.append(t)
            story.append(Spacer(1, 8))

        elif btype == 'ul':
            for level, item_text in content:
                style = styles['BulletNested'] if level == 'nested' else styles['BulletItem']
                bullet = '\u2022'
                if level == 'nested':
                    bullet = '\u2013'
                story.append(Paragraph(
                    f'{bullet}  {fmt(item_text)}',
                    style
                ))

        elif btype == 'ol':
            for idx, item_text in enumerate(content, 1):
                story.append(Paragraph(
                    f'{idx}.  {fmt(item_text)}',
                    styles['NumberedItem']
                ))

        elif btype == 'para':
            story.append(Paragraph(fmt(content), styles['Body']))

    return story


def add_page_number(canvas, doc):
    """Add page number and footer to each page."""
    canvas.saveState()
    # Page number
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(HexColor("#888888"))
    canvas.drawRightString(
        doc.pagesize[0] - 0.75 * inch,
        0.5 * inch,
        f"Page {canvas.getPageNumber()}"
    )
    # Footer line
    canvas.setStrokeColor(RULE_COLOR)
    canvas.setLineWidth(0.5)
    canvas.line(
        0.75 * inch, 0.65 * inch,
        doc.pagesize[0] - 0.75 * inch, 0.65 * inch
    )
    # Doc title in footer
    canvas.setFont('Helvetica', 7)
    canvas.drawString(
        0.75 * inch, 0.5 * inch,
        "AES6 Wow & Flutter Analyzer — SPA Architecture Spec"
    )
    canvas.restoreState()


def main():
    with open(SPEC_PATH, 'r') as f:
        md_text = f.read()

    styles = build_styles()
    blocks = parse_markdown(md_text)
    story = build_pdf(blocks, styles)

    doc = SimpleDocTemplate(
        OUTPUT_PATH,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.85 * inch,
        title="AES6 Wow & Flutter Analyzer — SPA Architecture Spec",
        author="AES6 W&F Project",
    )

    doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
    print(f"PDF generated: {OUTPUT_PATH}")


if __name__ == '__main__':
    main()
