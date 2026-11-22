import mammoth from 'mammoth';
import { jsPDF } from 'jspdf';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
} from 'docx';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ConversionMode = 'word-to-pdf' | 'pdf-to-word';

export interface ConversionProgress {
  percent: number;
  stage: string;
}

export interface ConversionResult {
  blob: Blob;
  fileName: string;
  stats: {
    pages: number;
    words: number;
    paragraphs?: number;
    images?: number;
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  const formatted = i === 0 ? value.toString() : value.toFixed(1).replace('.', ',');
  return `${formatted} ${units[i]}`;
}

export function getOutputFileName(originalName: string, targetExt: 'pdf' | 'docx'): string {
  const baseName = originalName.replace(/\.[^/.]+$/, '').trim() || 'documento';
  return `${baseName}.${targetExt}`;
}

function sanitizeWinAnsiText(input: string): string {
  const normalized = input
    .normalize('NFC')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '--')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '•')
    .replace(/[\u25CF\u25CB\u25AA\u25AB\u2043]/g, '•')
    .replace(/[\u2713\u2714\u2611]/g, '[v]')
    .replace(/[\u2717\u2718\u2612]/g, '[x]')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u2194/g, '<->');

  // Keep characters supported by WinAnsi (0x20-0xFF plus bullet/euro/etc mapped above)
  let out = '';
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (
      code === 0x09 ||
      code === 0x0A ||
      code === 0x0D ||
      (code >= 0x20 && code <= 0xFF) ||
      code === 0x2022 ||
      code === 0x20AC
    ) {
      out += normalized[i];
    } else if (code >= 0xD800 && code <= 0xDFFF) {
      // Skip surrogate pairs (emojis) cleanly
      continue;
    } else {
      out += ' ';
    }
  }
  return out;
}

interface InlineRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  code: boolean;
}

interface InlineState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  code: boolean;
}

function collectInlineRuns(
  node: Node,
  state: InlineState = { bold: false, italic: false, underline: false, code: false },
  runs: InlineRun[] = []
): InlineRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const raw = node.textContent ?? '';
    const cleaned = sanitizeWinAnsiText(raw.replace(/\s+/g, ' '));
    if (cleaned.length > 0) {
      runs.push({
        text: cleaned,
        bold: state.bold,
        italic: state.italic,
        underline: state.underline,
        code: state.code,
      });
    }
    return runs;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return runs;
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toUpperCase();

  if (tag === 'BR') {
    runs.push({
      text: '\n',
      bold: state.bold,
      italic: state.italic,
      underline: state.underline,
      code: state.code,
    });
    return runs;
  }

  const nextState: InlineState = {
    bold: state.bold || tag === 'STRONG' || tag === 'B' || tag === 'TH',
    italic: state.italic || tag === 'EM' || tag === 'I',
    underline: state.underline || tag === 'U' || tag === 'A',
    code: state.code || tag === 'CODE' || tag === 'KBD',
  };

  for (let i = 0; i < el.childNodes.length; i++) {
    collectInlineRuns(el.childNodes[i], nextState, runs);
  }

  return runs;
}

function getFontStyle(bold: boolean, italic: boolean): 'normal' | 'bold' | 'italic' | 'bolditalic' {
  if (bold && italic) return 'bolditalic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'normal';
}

async function normalizeImageToDataUrl(
  src: string
): Promise<{ dataUrl: string; format: 'PNG' | 'JPEG'; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width || 100;
      const height = img.naturalHeight || img.height || 100;
      if (width <= 0 || height <= 0) {
        resolve(null);
        return;
      }

      if (src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg')) {
        resolve({ dataUrl: src, format: 'JPEG', width, height });
        return;
      }
      if (src.startsWith('data:image/png')) {
        resolve({ dataUrl: src, format: 'PNG', width, height });
        return;
      }

      // Convert WebP, GIF, BMP, SVG etc. to PNG using an offscreen canvas
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const pngData = canvas.toDataURL('image/png');
        resolve({ dataUrl: pngData, format: 'PNG', width, height });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

class DocxToPdfRenderer {
  private pdf: jsPDF;
  private readonly pageWidth = 210;
  private readonly pageHeight = 297;
  private readonly marginLeft = 20;
  private readonly marginRight = 20;
  private readonly marginTop = 22;
  private readonly marginBottom = 22;
  private readonly contentWidth = 170; // 210 - 20 - 20
  private cursorY = 22;
  public imageCount = 0;

  constructor() {
    this.pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });
    this.pdf.setTextColor(15, 23, 42);
  }

  private ensureSpace(neededHeight: number): void {
    if (this.cursorY + neededHeight > this.pageHeight - this.marginBottom) {
      this.pdf.addPage();
      this.cursorY = this.marginTop;
    }
  }

  private renderInlineRuns(
    runs: InlineRun[],
    options: {
      fontSize: number;
      lineHeight: number;
      xStart?: number;
      maxWidth?: number;
      forceBold?: boolean;
      color?: [number, number, number];
      prefix?: string;
      prefixWidth?: number;
    }
  ): void {
    const xStart = options.xStart ?? this.marginLeft;
    const maxWidth = options.maxWidth ?? this.contentWidth;
    const color = options.color ?? [15, 23, 42];

    // Tokenize into words and explicit newlines while preserving spaces
    interface WordToken {
      text: string;
      bold: boolean;
      italic: boolean;
      underline: boolean;
      code: boolean;
      isNewline: boolean;
    }

    const tokens: WordToken[] = [];
    for (const run of runs) {
      if (run.text === '\n') {
        tokens.push({
          text: '',
          bold: run.bold,
          italic: run.italic,
          underline: run.underline,
          code: run.code,
          isNewline: true,
        });
        continue;
      }
      const parts = run.text.split(/(\s+)/);
      for (const part of parts) {
        if (!part) continue;
        tokens.push({
          text: part,
          bold: options.forceBold || run.bold,
          italic: run.italic,
          underline: run.underline,
          code: run.code,
          isNewline: false,
        });
      }
    }

    // Trim leading/trailing pure whitespace tokens
    while (tokens.length > 0 && !tokens[0].isNewline && tokens[0].text.trim() === '') {
      tokens.shift();
    }
    while (
      tokens.length > 0 &&
      !tokens[tokens.length - 1].isNewline &&
      tokens[tokens.length - 1].text.trim() === ''
    ) {
      tokens.pop();
    }

    if (tokens.length === 0) return;

    // Build wrapped lines
    const lines: WordToken[][] = [[]];
    let currentLineWidth = 0;

    const measureToken = (token: WordToken): number => {
      this.pdf.setFont(token.code ? 'courier' : 'helvetica', getFontStyle(token.bold, token.italic));
      this.pdf.setFontSize(token.code ? Math.max(8, options.fontSize - 1) : options.fontSize);
      return this.pdf.getTextWidth(token.text);
    };

    for (const token of tokens) {
      if (token.isNewline) {
        lines.push([]);
        currentLineWidth = 0;
        continue;
      }

      const tokenWidth = measureToken(token);
      const isSpace = token.text.trim() === '';

      if (lines[lines.length - 1].length === 0 && isSpace) {
        continue;
      }

      if (currentLineWidth + tokenWidth > maxWidth && lines[lines.length - 1].length > 0 && !isSpace) {
        // Trim trailing space on completed line
        const lastLine = lines[lines.length - 1];
        if (lastLine.length > 0 && lastLine[lastLine.length - 1].text.trim() === '') {
          lastLine.pop();
        }
        lines.push([token]);
        currentLineWidth = tokenWidth;
      } else if (tokenWidth > maxWidth && !isSpace) {
        // Long word fallback split
        this.pdf.setFont(token.code ? 'courier' : 'helvetica', getFontStyle(token.bold, token.italic));
        this.pdf.setFontSize(token.code ? Math.max(8, options.fontSize - 1) : options.fontSize);
        const splitChars = this.pdf.splitTextToSize(token.text, maxWidth) as string[];
        splitChars.forEach((chunk, idx) => {
          if (idx > 0 || lines[lines.length - 1].length > 0) {
            lines.push([]);
          }
          lines[lines.length - 1].push({ ...token, text: chunk });
          currentLineWidth = this.pdf.getTextWidth(chunk);
        });
      } else {
        lines[lines.length - 1].push(token);
        currentLineWidth += tokenWidth;
      }
    }

    // Draw each line
    lines.forEach((line, lineIndex) => {
      this.ensureSpace(options.lineHeight);
      let cursorX = xStart;

      if (lineIndex === 0 && options.prefix) {
        this.pdf.setFont('helvetica', 'bold');
        this.pdf.setFontSize(options.fontSize);
        this.pdf.setTextColor(color[0], color[1], color[2]);
        this.pdf.text(options.prefix, xStart - (options.prefixWidth ?? 5), this.cursorY);
      }

      for (const token of line) {
        const fontFamily = token.code ? 'courier' : 'helvetica';
        const fontStyle = getFontStyle(token.bold, token.italic);
        const fontSize = token.code ? Math.max(8, options.fontSize - 1) : options.fontSize;

        this.pdf.setFont(fontFamily, fontStyle);
        this.pdf.setFontSize(fontSize);
        if (token.underline && !token.code) {
          this.pdf.setTextColor(29, 78, 216);
        } else {
          this.pdf.setTextColor(color[0], color[1], color[2]);
        }

        this.pdf.text(token.text, cursorX, this.cursorY);
        const w = this.pdf.getTextWidth(token.text);

        if (token.underline && token.text.trim().length > 0) {
          this.pdf.setDrawColor(29, 78, 216);
          this.pdf.setLineWidth(0.2);
          this.pdf.line(cursorX, this.cursorY + 0.8, cursorX + w, this.cursorY + 0.8);
        }
        cursorX += w;
      }

      this.cursorY += options.lineHeight;
    });
  }

  private async renderTable(tableEl: HTMLTableElement): Promise<void> {
    const rows = Array.from(tableEl.querySelectorAll('tr'));
    if (rows.length === 0) return;

    const maxCols = Math.max(...rows.map((r) => r.querySelectorAll('th, td').length), 1);
    const colWidth = this.contentWidth / maxCols;
    const cellPaddingX = 2.5;
    const cellPaddingY = 2.2;
    const fontSize = 9.5;
    const lineHeight = 4.6;

    this.cursorY += 2;

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('th, td'));
      const isHeaderRow = cells.some((c) => c.tagName.toUpperCase() === 'TH');

      // Measure row height first
      const cellLines: { lines: string[]; isHeader: boolean }[] = [];
      let maxRowHeight = lineHeight + cellPaddingY * 2;

      for (let c = 0; c < maxCols; c++) {
        const cell = cells[c];
        const isHeader = cell ? cell.tagName.toUpperCase() === 'TH' : isHeaderRow;
        const text = cell ? sanitizeWinAnsiText((cell.textContent ?? '').replace(/\s+/g, ' ').trim()) : '';
        this.pdf.setFont('helvetica', isHeader ? 'bold' : 'normal');
        this.pdf.setFontSize(fontSize);
        const wrapped = text
          ? (this.pdf.splitTextToSize(text, Math.max(10, colWidth - cellPaddingX * 2)) as string[])
          : [''];
        const neededH = wrapped.length * lineHeight + cellPaddingY * 2;
        if (neededH > maxRowHeight) maxRowHeight = neededH;
        cellLines.push({ lines: wrapped, isHeader });
      }

      this.ensureSpace(maxRowHeight);

      // Draw cells
      for (let c = 0; c < maxCols; c++) {
        const cellX = this.marginLeft + c * colWidth;
        const cellData = cellLines[c];

        if (cellData.isHeader) {
          this.pdf.setFillColor(241, 245, 249);
          this.pdf.rect(cellX, this.cursorY, colWidth, maxRowHeight, 'FD');
        } else {
          this.pdf.setDrawColor(203, 213, 225);
          this.pdf.rect(cellX, this.cursorY, colWidth, maxRowHeight, 'D');
        }

        this.pdf.setFont('helvetica', cellData.isHeader ? 'bold' : 'normal');
        this.pdf.setFontSize(fontSize);
        this.pdf.setTextColor(15, 23, 42);

        cellData.lines.forEach((line, idx) => {
          this.pdf.text(
            line,
            cellX + cellPaddingX,
            this.cursorY + cellPaddingY + 3.2 + idx * lineHeight
          );
        });
      }

      this.cursorY += maxRowHeight;
    }

    this.cursorY += 4;
  }

  private async renderImageElement(imgEl: HTMLImageElement): Promise<void> {
    const src = imgEl.getAttribute('src');
    if (!src) return;

    const imgData = await normalizeImageToDataUrl(src);
    if (!imgData) return;

    // Convert px to mm assuming 96 DPI (~0.26458 mm/px)
    const pxToMm = 0.264583;
    let drawWidth = imgData.width * pxToMm;
    let drawHeight = imgData.height * pxToMm;

    const maxDrawWidth = this.contentWidth;
    const maxDrawHeight = this.pageHeight - this.marginTop - this.marginBottom - 10;

    if (drawWidth > maxDrawWidth) {
      const ratio = maxDrawWidth / drawWidth;
      drawWidth *= ratio;
      drawHeight *= ratio;
    }
    if (drawHeight > maxDrawHeight) {
      const ratio = maxDrawHeight / drawHeight;
      drawWidth *= ratio;
      drawHeight *= ratio;
    }

    this.ensureSpace(drawHeight + 4);
    this.pdf.addImage(
      imgData.dataUrl,
      imgData.format,
      this.marginLeft,
      this.cursorY,
      drawWidth,
      drawHeight
    );
    this.cursorY += drawHeight + 5;
    this.imageCount += 1;
  }

  private async renderList(listEl: HTMLElement, ordered: boolean, depth = 0): Promise<void> {
    const items = Array.from(listEl.children).filter(
      (child) => child.tagName.toUpperCase() === 'LI'
    ) as HTMLElement[];

    const indent = 6 + depth * 6;
    let index = 1;

    for (const li of items) {
      const nestedLists: HTMLElement[] = [];
      const inlineNodes: Node[] = [];

      for (let i = 0; i < li.childNodes.length; i++) {
        const child = li.childNodes[i];
        if (child.nodeType === Node.ELEMENT_NODE) {
          const childTag = (child as HTMLElement).tagName.toUpperCase();
          if (childTag === 'UL' || childTag === 'OL') {
            nestedLists.push(child as HTMLElement);
            continue;
          }
        }
        inlineNodes.push(child);
      }

      const runs: InlineRun[] = [];
      inlineNodes.forEach((n) => collectInlineRuns(n, undefined, runs));

      const prefix = ordered ? `${index}.` : '•';
      if (runs.length > 0) {
        this.renderInlineRuns(runs, {
          fontSize: 11,
          lineHeight: 5.4,
          xStart: this.marginLeft + indent,
          maxWidth: this.contentWidth - indent,
          prefix,
          prefixWidth: ordered ? 5.5 : 4,
        });
        this.cursorY += 1.2;
      }

      for (const nested of nestedLists) {
        await this.renderList(nested, nested.tagName.toUpperCase() === 'OL', depth + 1);
      }

      index += 1;
    }

    if (depth === 0) {
      this.cursorY += 2.5;
    }
  }

  public async renderContainer(container: HTMLElement): Promise<void> {
    for (let i = 0; i < container.childNodes.length; i++) {
      const node = container.childNodes[i];

      if (node.nodeType === Node.TEXT_NODE) {
        const txt = (node.textContent ?? '').trim();
        if (txt.length > 0) {
          this.renderInlineRuns(collectInlineRuns(node), {
            fontSize: 11,
            lineHeight: 5.5,
          });
          this.cursorY += 2.5;
        }
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      const el = node as HTMLElement;
      const tag = el.tagName.toUpperCase();

      if (tag === 'H1') {
        this.cursorY += 3;
        this.ensureSpace(12);
        this.renderInlineRuns(collectInlineRuns(el), {
          fontSize: 19,
          lineHeight: 8.2,
          forceBold: true,
          color: [15, 23, 42],
        });
        this.cursorY += 3.5;
      } else if (tag === 'H2') {
        this.cursorY += 2.5;
        this.ensureSpace(10);
        this.renderInlineRuns(collectInlineRuns(el), {
          fontSize: 15,
          lineHeight: 6.8,
          forceBold: true,
          color: [30, 41, 59],
        });
        this.cursorY += 2.8;
      } else if (tag === 'H3') {
        this.cursorY += 2;
        this.ensureSpace(9);
        this.renderInlineRuns(collectInlineRuns(el), {
          fontSize: 13,
          lineHeight: 6.0,
          forceBold: true,
          color: [30, 41, 59],
        });
        this.cursorY += 2.2;
      } else if (tag === 'H4' || tag === 'H5' || tag === 'H6') {
        this.cursorY += 1.5;
        this.ensureSpace(8);
        this.renderInlineRuns(collectInlineRuns(el), {
          fontSize: 11.5,
          lineHeight: 5.6,
          forceBold: true,
          color: [51, 65, 85],
        });
        this.cursorY += 2;
      } else if (tag === 'UL' || tag === 'OL') {
        await this.renderList(el, tag === 'OL', 0);
      } else if (tag === 'TABLE') {
        await this.renderTable(el as HTMLTableElement);
      } else if (tag === 'IMG') {
        await this.renderImageElement(el as HTMLImageElement);
      } else if (tag === 'HR') {
        this.ensureSpace(6);
        this.pdf.setDrawColor(203, 213, 225);
        this.pdf.setLineWidth(0.3);
        this.pdf.line(this.marginLeft, this.cursorY + 2, this.pageWidth - this.marginRight, this.cursorY + 2);
        this.cursorY += 6;
      } else if (tag === 'BLOCKQUOTE') {
        const startY = this.cursorY;
        const runs = collectInlineRuns(el);
        if (runs.length > 0) {
          this.renderInlineRuns(runs, {
            fontSize: 10.5,
            lineHeight: 5.3,
            xStart: this.marginLeft + 6,
            maxWidth: this.contentWidth - 6,
            color: [71, 85, 105],
          });
          if (this.cursorY > startY) {
            this.pdf.setDrawColor(148, 163, 184);
            this.pdf.setLineWidth(0.6);
            this.pdf.line(this.marginLeft + 2, startY - 3, this.marginLeft + 2, this.cursorY - 2);
          }
          this.cursorY += 2.5;
        }
      } else if (tag === 'PRE') {
        const rawText = sanitizeWinAnsiText(el.textContent ?? '');
        if (rawText.trim().length > 0) {
          this.pdf.setFont('courier', 'normal');
          this.pdf.setFontSize(9.5);
          this.pdf.setTextColor(30, 41, 59);
          const codeLines = this.pdf.splitTextToSize(rawText, this.contentWidth - 6) as string[];
          for (const line of codeLines) {
            this.ensureSpace(4.8);
            this.pdf.text(line, this.marginLeft + 3, this.cursorY);
            this.cursorY += 4.6;
          }
          this.cursorY += 3;
        }
      } else if (tag === 'P') {
        // Check if paragraph contains standalone images alongside or inside it
        const imgs = Array.from(el.querySelectorAll('img'));
        const runs = collectInlineRuns(el);
        if (runs.length > 0) {
          this.renderInlineRuns(runs, {
            fontSize: 11,
            lineHeight: 5.5,
          });
          this.cursorY += 2.8;
        }
        for (const img of imgs) {
          await this.renderImageElement(img);
        }
      } else if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN') {
        await this.renderContainer(el);
      } else {
        const runs = collectInlineRuns(el);
        if (runs.length > 0) {
          this.renderInlineRuns(runs, {
            fontSize: 11,
            lineHeight: 5.5,
          });
          this.cursorY += 2.5;
        }
      }
    }
  }

  public finalize(): { blob: Blob; pages: number } {
    const totalPages = this.pdf.getNumberOfPages();
    if (totalPages > 1) {
      for (let p = 1; p <= totalPages; p++) {
        this.pdf.setPage(p);
        this.pdf.setFont('helvetica', 'normal');
        this.pdf.setFontSize(8.5);
        this.pdf.setTextColor(100, 116, 139);
        this.pdf.text(`Página ${p} de ${totalPages}`, this.pageWidth / 2, this.pageHeight - 10, {
          align: 'center',
        });
      }
    }

    const blob = this.pdf.output('blob');
    return { blob, pages: totalPages };
  }
}

export async function convertDocxToPdf(
  file: File,
  onProgress?: (progress: ConversionProgress) => void
): Promise<ConversionResult> {
  if (!file) {
    throw new Error('Nenhum arquivo foi selecionado.');
  }

  if (file.size === 0) {
    throw new Error('O arquivo enviado está vazio (0 bytes) e não pode ser convertido.');
  }

  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.doc')) {
    throw new Error(
      'O formato antigo .DOC não é compatível. Salve o documento como .DOCX no Word e tente novamente.'
    );
  }
  if (!lowerName.endsWith('.docx')) {
    throw new Error('Formato inválido. Por favor, selecione um arquivo Word no formato .DOCX.');
  }

  onProgress?.({ percent: 15, stage: 'Lendo arquivo DOCX...' });

  let arrayBuffer: ArrayBuffer | null = await file.arrayBuffer();
  const header = new Uint8Array(arrayBuffer.slice(0, 4));

  // Legacy OLE2 .doc binary signature (D0 CF 11 E0)
  if (header[0] === 0xd0 && header[1] === 0xcf && header[2] === 0x11 && header[3] === 0xe0) {
    arrayBuffer = null;
    throw new Error(
      'Este arquivo está no formato binário antigo (.DOC), mesmo com extensão .DOCX. Salve-o novamente como Documento do Word (.DOCX).'
    );
  }

  // DOCX is a ZIP container starting with "PK" (0x50 0x4B)
  if (header[0] !== 0x50 || header[1] !== 0x4b) {
    arrayBuffer = null;
    throw new Error('O arquivo selecionado não é um documento .DOCX válido ou está corrompido.');
  }

  onProgress?.({ percent: 40, stage: 'Extraindo estrutura e formatação do Word...' });

  let htmlContent = '';
  try {
    const result = await mammoth.convertToHtml(
      { arrayBuffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const base64 = await image.read('base64');
          return {
            src: `data:${image.contentType};base64,${base64}`,
          };
        }),
      }
    );
    htmlContent = result.value;
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('encrypt') || msg.includes('password')) {
      throw new Error('Este documento Word está protegido por senha. Remova a proteção antes de converter.');
    }
    throw new Error(
      'Não foi possível ler este arquivo .DOCX. Verifique se o documento não está danificado ou protegido.'
    );
  } finally {
    // Release ArrayBuffer reference immediately
    arrayBuffer = null;
  }

  onProgress?.({ percent: 68, stage: 'Montando páginas do PDF...' });

  const parser = new DOMParser();
  const parsedDoc = parser.parseFromString(htmlContent, 'text/html');
  const plainText = (parsedDoc.body.textContent ?? '').trim();
  const hasImages = parsedDoc.body.querySelectorAll('img').length > 0;

  if (plainText.length === 0 && !hasImages) {
    throw new Error('O documento Word está vazio e não possui texto ou imagens para gerar o PDF.');
  }

  const wordCount = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;

  const renderer = new DocxToPdfRenderer();
  await renderer.renderContainer(parsedDoc.body);

  onProgress?.({ percent: 90, stage: 'Finalizando arquivo PDF...' });
  const { blob, pages } = renderer.finalize();

  if (!blob || blob.size === 0) {
    throw new Error('O PDF gerado ficou vazio. Verifique o conteúdo do documento original.');
  }

  onProgress?.({ percent: 100, stage: 'Conversão concluída!' });

  return {
    blob,
    fileName: getOutputFileName(file.name, 'pdf'),
    stats: {
      pages,
      words: wordCount,
      images: renderer.imageCount,
    },
  };
}

interface ExtractedLine {
  text: string;
  fontSize: number;
  y: number;
  x: number;
  bold: boolean;
  italic: boolean;
}

export async function convertPdfToDocx(
  file: File,
  onProgress?: (progress: ConversionProgress) => void
): Promise<ConversionResult> {
  if (!file) {
    throw new Error('Nenhum arquivo foi selecionado.');
  }

  if (file.size === 0) {
    throw new Error('O arquivo PDF enviado está vazio (0 bytes) e não pode ser convertido.');
  }

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Formato inválido. Por favor, selecione um arquivo no formato .PDF.');
  }

  onProgress?.({ percent: 12, stage: 'Validando arquivo PDF...' });

  let arrayBuffer: ArrayBuffer | null = await file.arrayBuffer();
  const headerSlice = new Uint8Array(arrayBuffer.slice(0, Math.min(1024, arrayBuffer.byteLength)));
  const headerText = new TextDecoder('latin1').decode(headerSlice);

  if (!headerText.includes('%PDF-')) {
    arrayBuffer = null;
    throw new Error('O arquivo selecionado não é um PDF válido ou está corrompido.');
  }

  onProgress?.({ percent: 24, stage: 'Carregando páginas do PDF...' });

  let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
  let pdfDocument: pdfjsLib.PDFDocumentProxy | null = null;

  try {
    loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(arrayBuffer),
      useSystemFonts: true,
    });
    arrayBuffer = null;

    pdfDocument = await loadingTask.promise;
    const numPages = pdfDocument.numPages;

    if (numPages === 0) {
      throw new Error('O arquivo PDF não possui páginas.');
    }

    const pagesLines: ExtractedLine[][] = [];
    const allFontSizes: number[] = [];
    let totalCharacters = 0;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const progressPct = 25 + Math.round((pageNum / numPages) * 55);
      onProgress?.({
        percent: progressPct,
        stage: `Extraindo texto da página ${pageNum} de ${numPages}...`,
      });

      const page = await pdfDocument.getPage(pageNum);
      try {
        const textContent = await page.getTextContent();
        const styles = textContent.styles ?? {};

        interface RawGlyph {
          str: string;
          x: number;
          y: number;
          width: number;
          fontSize: number;
          bold: boolean;
          italic: boolean;
        }

        const glyphs: RawGlyph[] = [];
        for (const item of textContent.items) {
          if (!('str' in item)) continue;
          const str = item.str;
          if (!str || str.length === 0) continue;

          const transform = item.transform;
          const fontSize = Math.max(6, Math.hypot(transform[0], transform[1]) || Math.abs(transform[3]) || 11);
          const x = transform[4];
          const y = transform[5];
          const width = item.width ?? 0;

          const styleInfo = styles[item.fontName];
          const fontDesc = `${item.fontName ?? ''} ${styleInfo?.fontFamily ?? ''}`.toLowerCase();
          const bold = /bold|black|heavy|semibold|demi/.test(fontDesc);
          const italic = /italic|oblique|slant/.test(fontDesc);

          glyphs.push({ str, x, y, width, fontSize, bold, italic });
          if (str.trim().length > 0) {
            allFontSizes.push(fontSize);
          }
        }

        // Group glyphs into lines by Y coordinate
        glyphs.sort((a, b) => b.y - a.y || a.x - b.x);

        const lineGroups: RawGlyph[][] = [];
        for (const g of glyphs) {
          const tolerance = Math.max(2.5, g.fontSize * 0.45);
          const targetGroup = lineGroups.find((group) => Math.abs(group[0].y - g.y) <= tolerance);
          if (targetGroup) {
            targetGroup.push(g);
          } else {
            lineGroups.push([g]);
          }
        }

        const pageLines: ExtractedLine[] = [];
        for (const group of lineGroups) {
          group.sort((a, b) => a.x - b.x);
          let combined = '';
          let prevEnd = group[0].x;
          let weightedSizeSum = 0;
          let boldChars = 0;
          let italicChars = 0;
          let totalCharsInLine = 0;

          for (let idx = 0; idx < group.length; idx++) {
            const g = group[idx];
            if (idx > 0) {
              const gap = g.x - prevEnd;
              const spaceThreshold = Math.max(1.5, g.fontSize * 0.22);
              const needsSpace =
                gap > spaceThreshold &&
                !combined.endsWith(' ') &&
                !g.str.startsWith(' ');
              if (needsSpace) {
                combined += ' ';
              }
            }
            combined += g.str;
            prevEnd = g.x + g.width;

            const trimmedLen = g.str.trim().length;
            if (trimmedLen > 0) {
              weightedSizeSum += g.fontSize * trimmedLen;
              if (g.bold) boldChars += trimmedLen;
              if (g.italic) italicChars += trimmedLen;
              totalCharsInLine += trimmedLen;
            }
          }

          const cleanText = combined.replace(/\s+/g, ' ').trim();
          if (cleanText.length > 0) {
            totalCharacters += cleanText.length;
            pageLines.push({
              text: cleanText,
              fontSize: totalCharsInLine > 0 ? weightedSizeSum / totalCharsInLine : group[0].fontSize,
              y: group[0].y,
              x: group[0].x,
              bold: boldChars > totalCharsInLine * 0.6,
              italic: italicChars > totalCharsInLine * 0.6,
            });
          }
        }

        pagesLines.push(pageLines);
      } finally {
        page.cleanup();
      }
    }

    if (totalCharacters === 0) {
      throw new Error(
        'Nenhum texto selecionável foi encontrado neste PDF. Arquivos PDF digitalizados como imagem precisam de OCR antes da conversão para Word.'
      );
    }

    onProgress?.({ percent: 86, stage: 'Construindo documento Word editável (.DOCX)...' });

    // Calculate median font size for heading detection
    allFontSizes.sort((a, b) => a - b);
    const medianFontSize = allFontSizes[Math.floor(allFontSizes.length / 2)] || 11;

    const docChildren: Paragraph[] = [];
    let paragraphCount = 0;
    let totalWords = 0;

    for (let pIdx = 0; pIdx < pagesLines.length; pIdx++) {
      const lines = pagesLines[pIdx];
      if (lines.length === 0) continue;

      if (pIdx > 0 && docChildren.length > 0) {
        docChildren.push(new Paragraph({ children: [new PageBreak()] }));
      }

      let currentParaLines: ExtractedLine[] = [];

      const flushParagraph = () => {
        if (currentParaLines.length === 0) return;
        const first = currentParaLines[0];
        const joinedText = currentParaLines
          .map((l) => l.text)
          .reduce((acc, part) => {
            if (!acc) return part;
            // Rejoin hyphenated word breaks naturally
            if (acc.endsWith('-') && /^[a-záàâãéêíóôõúüç]/i.test(part)) {
              return acc.slice(0, -1) + part;
            }
            return `${acc} ${part}`;
          }, '');

        const clean = joinedText.trim();
        if (!clean) {
          currentParaLines = [];
          return;
        }

        totalWords += clean.split(/\s+/).filter(Boolean).length;
        paragraphCount += 1;

        const isHeading1 =
          first.fontSize >= medianFontSize * 1.38 && clean.length <= 140 && currentParaLines.length <= 2;
        const isHeading2 =
          !isHeading1 &&
          first.fontSize >= medianFontSize * 1.16 &&
          clean.length <= 160 &&
          currentParaLines.length <= 2;

        if (isHeading1) {
          docChildren.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 240, after: 120 },
              children: [
                new TextRun({
                  text: clean,
                  bold: true,
                  size: 32, // 16pt
                  font: 'Calibri',
                }),
              ],
            })
          );
        } else if (isHeading2) {
          docChildren.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 100 },
              children: [
                new TextRun({
                  text: clean,
                  bold: true,
                  size: 26, // 13pt
                  font: 'Calibri',
                }),
              ],
            })
          );
        } else {
          const allBold = currentParaLines.every((l) => l.bold);
          const allItalic = currentParaLines.every((l) => l.italic);
          docChildren.push(
            new Paragraph({
              spacing: { after: 140, line: 276 },
              children: [
                new TextRun({
                  text: clean,
                  bold: allBold,
                  italics: allItalic,
                  size: 22, // 11pt
                  font: 'Calibri',
                }),
              ],
            })
          );
        }

        currentParaLines = [];
      };

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const prev = currentParaLines[currentParaLines.length - 1];

        const isListMarker = /^([•\-*▪◦]|\d{1,3}[.)])\s+/.test(line.text);
        const isHeadingCandidate = line.fontSize >= medianFontSize * 1.16 && line.text.length <= 140;

        if (!prev) {
          currentParaLines.push(line);
          if (isHeadingCandidate) {
            flushParagraph();
          }
          continue;
        }

        const verticalGap = prev.y - line.y;
        const normalLineStep = Math.max(prev.fontSize, line.fontSize) * 1.55;
        const sizeChanged = Math.abs(line.fontSize - prev.fontSize) > 2;

        if (verticalGap > normalLineStep || verticalGap < -5 || isListMarker || isHeadingCandidate || sizeChanged) {
          flushParagraph();
        }

        currentParaLines.push(line);
      }

      flushParagraph();
    }

    if (docChildren.length === 0) {
      throw new Error('Não foi possível extrair parágrafos editáveis deste arquivo PDF.');
    }

    onProgress?.({ percent: 94, stage: 'Empacotando arquivo DOCX...' });

    const doc = new Document({
      creator: 'WordPDF – Conversor de Documentos',
      description: 'Documento convertido de PDF para Word no navegador',
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440, // 1 inch
                right: 1440,
                bottom: 1440,
                left: 1440,
              },
            },
          },
          children: docChildren,
        },
      ],
    });

    const docxBlob = await Packer.toBlob(doc);

    if (!docxBlob || docxBlob.size === 0) {
      throw new Error('O arquivo Word gerado ficou vazio.');
    }

    onProgress?.({ percent: 100, stage: 'Conversão concluída!' });

    return {
      blob: docxBlob,
      fileName: getOutputFileName(file.name, 'docx'),
      stats: {
        pages: numPages,
        paragraphs: paragraphCount,
        words: totalWords,
      },
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes('OCR')) {
      throw err;
    }

    const errName = (err as { name?: string })?.name ?? '';
    const errMsg = err instanceof Error ? err.message.toLowerCase() : '';

    if (errName === 'PasswordException' || errMsg.includes('password')) {
      throw new Error(
        'Este PDF está protegido por senha. Desbloqueie o arquivo antes de converter para Word.'
      );
    }

    if (
      errName === 'InvalidPDFException' ||
      errName === 'MissingPDFException' ||
      errName === 'FormatError' ||
      errMsg.includes('invalid pdf')
    ) {
      throw new Error(
        'O arquivo PDF está danificado, incompleto ou em um formato incompatível.'
      );
    }

    if (err instanceof Error && err.message) {
      throw err;
    }

    throw new Error('Ocorreu um erro inesperado ao processar o PDF. Verifique o arquivo e tente novamente.');
  } finally {
    if (pdfDocument) {
      try {
        await pdfDocument.cleanup();
      } catch {
        // Ignore cleanup errors
      }
      pdfDocument = null;
    }
    if (loadingTask) {
      try {
        await loadingTask.destroy();
      } catch {
        // Ignore cleanup errors
      }
      loadingTask = null;
    }
    arrayBuffer = null;
  }
}
