import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileUp,
  Info,
  Loader2,
  Lock,
  RefreshCw,
  Share2,
  ShieldCheck,
  Trash2,
  Zap,
} from 'lucide-react';
import { PdfDocIcon, WordDocIcon, WordPdfLogo } from './components/DocumentIcons';
import {
  ConversionMode,
  ConversionProgress,
  ConversionResult,
  convertDocxToPdf,
  convertPdfToDocx,
  formatFileSize,
} from './services/converter';
import {
  canShareFiles,
  downloadForWebViewOrBrowser,
  isAndroidWebView,
  shareConvertedFile,
} from './utils/webview';

type Status = 'idle' | 'ready' | 'converting' | 'success' | 'error';

export default function App() {
  const [mode, setMode] = useState<ConversionMode>('word-to-pdf');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<ConversionProgress>({ percent: 0, stage: '' });
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const converterSectionRef = useRef<HTMLElement>(null);

  const releaseMemory = useCallback(() => {
    setDownloadUrl((prevUrl) => {
      if (prevUrl) {
        URL.revokeObjectURL(prevUrl);
      }
      return null;
    });
    setResult(null);
  }, []);

  useEffect(() => {
    return () => {
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  const resetConverter = useCallback(() => {
    releaseMemory();
    setSelectedFile(null);
    setStatus('idle');
    setProgress({ percent: 0, stage: '' });
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [releaseMemory]);

  const handleModeChange = useCallback(
    (nextMode: ConversionMode, scrollToTool = false) => {
      if (status === 'converting') return;
      if (nextMode !== mode) {
        releaseMemory();
        setSelectedFile(null);
        setStatus('idle');
        setProgress({ percent: 0, stage: '' });
        setErrorMessage(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        setMode(nextMode);
      }
      if (scrollToTool) {
        converterSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    [mode, releaseMemory, status]
  );

  const validateAndSelectFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;

      releaseMemory();
      setErrorMessage(null);

      const lower = file.name.toLowerCase();

      if (file.size === 0) {
        setSelectedFile(null);
        setStatus('error');
        setErrorMessage('O arquivo selecionado está vazio (0 bytes) e não pode ser convertido.');
        return;
      }

      if (mode === 'word-to-pdf') {
        if (lower.endsWith('.doc')) {
          setSelectedFile(null);
          setStatus('error');
          setErrorMessage(
            'O formato antigo .DOC não é compatível. Salve o arquivo como .DOCX no Microsoft Word ou LibreOffice e tente novamente.'
          );
          return;
        }
        if (!lower.endsWith('.docx')) {
          setSelectedFile(null);
          setStatus('error');
          setErrorMessage(
            `Formato incompatível ("${file.name}"). Para converter Word para PDF, envie um arquivo .DOCX.`
          );
          return;
        }
      } else {
        if (!lower.endsWith('.pdf')) {
          setSelectedFile(null);
          setStatus('error');
          setErrorMessage(
            `Formato incompatível ("${file.name}"). Para converter PDF para Word, envie um arquivo .PDF.`
          );
          return;
        }
      }

      setSelectedFile(file);
      setStatus('ready');
    },
    [mode, releaseMemory]
  );

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    validateAndSelectFile(file);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (status === 'converting') return;
    setIsDragging(true);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (status === 'converting') return;
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (status === 'converting') return;
    const file = e.dataTransfer.files?.[0];
    validateAndSelectFile(file);
  };

  const openFilePicker = () => {
    if (status === 'converting') return;
    fileInputRef.current?.click();
  };

  const handleConvert = async () => {
    if (!selectedFile || status === 'converting') return;

    releaseMemory();
    setErrorMessage(null);
    setStatus('converting');
    setProgress({ percent: 5, stage: 'Iniciando processamento local...' });

    try {
      const conversionResult =
        mode === 'word-to-pdf'
          ? await convertDocxToPdf(selectedFile, setProgress)
          : await convertPdfToDocx(selectedFile, setProgress);

      const objectUrl = URL.createObjectURL(conversionResult.blob);
      setResult(conversionResult);
      setDownloadUrl(objectUrl);
      setStatus('success');
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Não foi possível converter este documento. Verifique se o arquivo não está corrompido ou protegido.';
      setErrorMessage(message);
      setStatus('error');
    }
  };

  const handleDownload = async () => {
    if (!downloadUrl || !result) return;
    try {
      await downloadForWebViewOrBrowser(result.blob, downloadUrl, result.fileName);
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Não foi possível iniciar o download do arquivo.';
      setErrorMessage(msg);
      setStatus('error');
    }
  };

  const handleShare = async () => {
    if (!result) return;
    try {
      await shareConvertedFile(result.blob, result.fileName);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      await handleDownload();
    }
  };

  const isWordToPdf = mode === 'word-to-pdf';
  const runningInWebView = isAndroidWebView();
  const acceptExtension = runningInWebView
    ? isWordToPdf
      ? '*/*'
      : 'application/pdf,.pdf'
    : isWordToPdf
    ? '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : '.pdf,application/pdf';
  const supportsShare = result ? canShareFiles(result.blob, result.fileName) : false;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar (3-zone contract) */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Brand wordmark */}
          <a
            href="#top"
            className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600 rounded-md"
          >
            <WordPdfLogo className="h-8 w-8 shrink-0" />
            <span>WordPDF</span>
          </a>

          {/* Zone 2: Clean single-line navigation */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => handleModeChange('word-to-pdf', true)}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-blue-600 cursor-pointer ${
                isWordToPdf ? 'text-blue-600 font-semibold' : ''
              }`}
            >
              Word para PDF
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('pdf-to-word', true)}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-blue-600 cursor-pointer ${
                !isWordToPdf ? 'text-blue-600 font-semibold' : ''
              }`}
            >
              PDF para Word
            </button>
            <a
              href="#como-funciona"
              className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-900"
            >
              Como funciona
            </a>
            <a
              href="#privacidade"
              className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-900"
            >
              Privacidade
            </a>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => {
                converterSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                openFilePicker();
              }}
              disabled={status === 'converting'}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              Selecionar arquivo
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* Hero & Converter Workspace */}
        <section
          ref={converterSectionRef}
          className="pt-10 pb-16 sm:pt-14 sm:pb-20 px-4 sm:px-6 lg:px-8"
        >
          <div className="max-w-4xl mx-auto">
            {/* Hero Header */}
            <div className="text-center max-w-2xl mx-auto mb-10">
              <h1
                className="text-3xl sm:text-4xl lg:text-[2.65rem] font-bold tracking-tight text-slate-900 leading-[1.15]"
                style={{ textWrap: 'balance' }}
              >
                Converta Word e PDF diretamente no navegador
              </h1>
              <p className="mt-4 text-base sm:text-lg text-slate-600 leading-relaxed">
                Ferramenta gratuita, rápida e sem cadastro. Seus documentos são processados
                localmente no seu dispositivo, sem envio para servidores.
              </p>
            </div>

            {/* Two Highlighted Conversion Options */}
            <div
              className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6"
              role="tablist"
              aria-label="Escolha o tipo de conversão"
            >
              <button
                type="button"
                role="tab"
                aria-selected={isWordToPdf}
                disabled={status === 'converting'}
                onClick={() => handleModeChange('word-to-pdf')}
                className={`text-left p-5 rounded-xl border transition-all duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 disabled:cursor-not-allowed ${
                  isWordToPdf
                    ? 'bg-white border-blue-600 ring-2 ring-blue-600/15 shadow-sm'
                    : 'bg-white/70 border-slate-200 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div className="flex items-center gap-2.5">
                    <WordDocIcon className="h-9 w-9" />
                    <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <PdfDocIcon className="h-9 w-9" />
                  </div>
                  <span
                    className={`text-xs font-semibold font-mono ${
                      isWordToPdf ? 'text-blue-600' : 'text-slate-400'
                    }`}
                  >
                    DOCX → PDF
                  </span>
                </div>
                <h2 className="text-lg font-bold text-slate-900">Word para PDF</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Converta documentos .DOCX em arquivos PDF prontos para compartilhar ou imprimir.
                </p>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={!isWordToPdf}
                disabled={status === 'converting'}
                onClick={() => handleModeChange('pdf-to-word')}
                className={`text-left p-5 rounded-xl border transition-all duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 disabled:cursor-not-allowed ${
                  !isWordToPdf
                    ? 'bg-white border-blue-600 ring-2 ring-blue-600/15 shadow-sm'
                    : 'bg-white/70 border-slate-200 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div className="flex items-center gap-2.5">
                    <PdfDocIcon className="h-9 w-9" />
                    <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
                    <WordDocIcon className="h-9 w-9" />
                  </div>
                  <span
                    className={`text-xs font-semibold font-mono ${
                      !isWordToPdf ? 'text-blue-600' : 'text-slate-400'
                    }`}
                  >
                    PDF → DOCX
                  </span>
                </div>
                <h2 className="text-lg font-bold text-slate-900">PDF para Word</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Extraia o texto de arquivos .PDF para um documento Word (.DOCX) editável.
                </p>
              </button>
            </div>

            {/* Central Converter Card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm">
              {/* OCR & Formatting Notice for PDF to Word */}
              {!isWordToPdf && (
                <div className="mb-6 flex items-start gap-3 rounded-xl bg-amber-50/80 border border-amber-200 px-4 py-3.5 text-sm text-amber-950">
                  <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="font-semibold text-amber-950">
                      Aviso sobre PDFs digitalizados e formatação
                    </p>
                    <p className="mt-0.5 text-amber-900 leading-relaxed">
                      Arquivos PDF digitalizados como imagem precisam de OCR (reconhecimento de
                      texto) e não possuem texto extraível. Além disso, a formatação original
                      complexa pode não ser preservada perfeitamente no arquivo Word gerado.
                    </p>
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept={acceptExtension}
                onChange={handleFileInputChange}
                className="sr-only"
                aria-label={
                  isWordToPdf
                    ? 'Selecionar arquivo Word no formato DOCX'
                    : 'Selecionar arquivo PDF'
                }
              />

              {/* Dropzone (shown when no file is active or in error state without a valid file) */}
              {!selectedFile && status !== 'converting' && status !== 'success' && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={openFilePicker}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openFilePicker();
                    }
                  }}
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`flex flex-col items-center justify-center text-center rounded-xl border-2 border-dashed px-6 py-12 sm:py-16 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                    isDragging
                      ? 'border-blue-600 bg-blue-50/80'
                      : 'border-slate-300 bg-slate-50/60 hover:border-blue-500 hover:bg-blue-50/30'
                  }`}
                >
                  <div className="mb-4 flex items-center justify-center h-14 w-14 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100">
                    <FileUp className="h-7 w-7" aria-hidden="true" />
                  </div>

                  <p className="text-lg sm:text-xl font-bold text-slate-900">
                    {isDragging
                      ? 'Solte o arquivo aqui para carregar'
                      : isWordToPdf
                      ? 'Arraste e solte seu arquivo .DOCX aqui'
                      : 'Arraste e solte seu arquivo .PDF aqui'}
                  </p>
                  <p className="mt-1.5 text-sm text-slate-600">
                    ou clique no botão abaixo para selecionar do seu computador ou celular
                  </p>

                  <span className="mt-6 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-blue-600 text-white text-base font-semibold hover:bg-blue-700 transition-colors">
                    {isWordToPdf ? 'Escolher arquivo DOCX' : 'Escolher arquivo PDF'}
                  </span>

                  <p className="mt-4 text-xs text-slate-500">
                    {isWordToPdf
                      ? 'Formato aceito: .docx · Processamento local imediato'
                      : 'Formato aceito: .pdf · Processamento local imediato'}
                  </p>
                </div>
              )}

              {/* Selected File State (Ready / Converting / Error with file) */}
              {selectedFile && status !== 'success' && (
                <div className="space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="flex items-center gap-4 min-w-0">
                      {isWordToPdf ? (
                        <WordDocIcon className="h-11 w-11 shrink-0" />
                      ) : (
                        <PdfDocIcon className="h-11 w-11 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-base font-semibold text-slate-900 truncate">
                          {selectedFile.name}
                        </p>
                        <div className="mt-0.5 flex items-center gap-2 text-sm text-slate-500 font-mono tabular-nums">
                          <span>{formatFileSize(selectedFile.size)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{isWordToPdf ? 'Documento Word (.docx)' : 'Documento PDF (.pdf)'}</span>
                        </div>
                      </div>
                    </div>

                    {status !== 'converting' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={openFilePicker}
                          className="px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          Trocar arquivo
                        </button>
                        <button
                          type="button"
                          onClick={resetConverter}
                          aria-label="Remover arquivo selecionado"
                          className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-5 w-5" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Progress Indicator */}
                  {status === 'converting' && (
                    <div
                      className="p-5 rounded-xl bg-blue-50/70 border border-blue-200"
                      role="status"
                      aria-live="polite"
                    >
                      <div className="flex items-center justify-between gap-4 mb-2.5">
                        <div className="flex items-center gap-2.5 text-sm font-semibold text-blue-950">
                          <Loader2 className="h-4 w-4 animate-spin text-blue-600 shrink-0" />
                          <span>{progress.stage || 'Convertendo documento...'}</span>
                        </div>
                        <span className="text-sm font-semibold font-mono tabular-nums text-blue-700">
                          {progress.percent}%
                        </span>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-blue-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-600 transition-all duration-200"
                          style={{ width: `${Math.max(4, progress.percent)}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Primary Convert Action */}
                  {status !== 'converting' && (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={handleConvert}
                        className="w-full sm:w-auto min-w-[260px] inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-xl bg-blue-600 text-white text-base sm:text-lg font-bold hover:bg-blue-700 active:bg-blue-800 transition-colors cursor-pointer shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                      >
                        <span>{isWordToPdf ? 'Converter para PDF' : 'Converter para Word'}</span>
                        <ArrowRight className="h-5 w-5" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Error Message */}
              {status === 'error' && errorMessage && (
                <div
                  role="alert"
                  className="mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl bg-red-50 border border-red-200 p-4 sm:p-5 text-red-950"
                >
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-bold text-red-950">
                        Não foi possível concluir a conversão
                      </p>
                      <p className="mt-1 text-sm text-red-800 leading-relaxed">{errorMessage}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={resetConverter}
                    className="shrink-0 px-4 py-2 text-sm font-semibold text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-100/60 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Tentar outro arquivo
                  </button>
                </div>
              )}

              {/* Success & Download State */}
              {status === 'success' && result && downloadUrl && (
                <div className="space-y-6" role="status" aria-live="polite">
                  <div className="flex items-start gap-3.5 rounded-xl bg-emerald-50 border border-emerald-200 p-5">
                    <CheckCircle2
                      className="h-6 w-6 text-emerald-600 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-bold text-emerald-950">
                        Conversão concluída com sucesso!
                      </p>
                      <p className="mt-1 text-sm text-emerald-900 break-all">
                        Arquivo pronto: <span className="font-semibold">{result.fileName}</span>
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-emerald-800 font-mono tabular-nums">
                        <span>{formatFileSize(result.blob.size)}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {result.stats.pages}{' '}
                          {result.stats.pages === 1 ? 'página' : 'páginas'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{result.stats.words} palavras</span>
                        {typeof result.stats.images === 'number' && result.stats.images > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {result.stats.images}{' '}
                              {result.stats.images === 1 ? 'imagem' : 'imagens'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="inline-flex items-center justify-center gap-2.5 px-8 py-4 rounded-xl bg-blue-600 text-white text-base sm:text-lg font-bold hover:bg-blue-700 active:bg-blue-800 transition-colors cursor-pointer shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                    >
                      <Download className="h-5 w-5" aria-hidden="true" />
                      <span>{isWordToPdf ? 'Baixar PDF convertido' : 'Baixar Word (.docx)'}</span>
                    </button>

                    {supportsShare && (
                      <button
                        type="button"
                        onClick={handleShare}
                        className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-white text-blue-700 border border-blue-200 text-base font-semibold hover:bg-blue-50 transition-colors cursor-pointer"
                      >
                        <Share2 className="h-4 w-4" aria-hidden="true" />
                        <span>Compartilhar / Salvar</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={resetConverter}
                      className="inline-flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-white text-slate-700 border border-slate-200 text-base font-semibold hover:bg-slate-50 hover:border-slate-300 transition-colors cursor-pointer"
                    >
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                      <span>Converter outro arquivo</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="como-funciona" className="py-14 bg-white border-t border-slate-200 px-4 sm:px-6 lg:px-8">
          <div className="max-w-5xl mx-auto">
            <div className="max-w-2xl mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                Como funciona a conversão
              </h2>
              <p className="mt-2 text-base text-slate-600">
                Tudo acontece em três passos simples diretamente no seu navegador, sem filas e sem
                limites de uso.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div>
                <p className="text-sm font-mono font-semibold text-blue-600">01.</p>
                <h3 className="mt-2 text-lg font-bold text-slate-900">Escolha a conversão</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Selecione Word para PDF (.docx) ou PDF para Word (.pdf) e arraste seu documento
                  para a área de envio.
                </p>
              </div>

              <div>
                <p className="text-sm font-mono font-semibold text-blue-600">02.</p>
                <h3 className="mt-2 text-lg font-bold text-slate-900">Processamento local</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  O navegador lê a estrutura do arquivo e monta o novo documento em segundos, sem
                  enviar dados pela internet.
                </p>
              </div>

              <div>
                <p className="text-sm font-mono font-semibold text-blue-600">03.</p>
                <h3 className="mt-2 text-lg font-bold text-slate-900">Baixe na hora</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Clique no botão de download para salvar seu PDF ou DOCX editável. Ao finalizar, a
                  memória é liberada automaticamente.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Privacy & Security */}
        <section id="privacidade" className="py-14 bg-slate-50 border-t border-slate-200 px-4 sm:px-6 lg:px-8">
          <div className="max-w-5xl mx-auto">
            <div className="max-w-2xl mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                Privacidade e acesso gratuito
              </h2>
              <p className="mt-2 text-base text-slate-600">
                Projetado para proteger documentos pessoais, contratos e trabalhos acadêmicos sem
                armazenamento externo.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <Lock className="h-6 w-6 text-blue-600 mb-3" aria-hidden="true" />
                <h3 className="text-base font-bold text-slate-900">100% no navegador</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Seus arquivos nunca saem do seu computador ou celular. Não existe upload para
                  servidores externos nem banco de dados.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6">
                <ShieldCheck className="h-6 w-6 text-blue-600 mb-3" aria-hidden="true" />
                <h3 className="text-base font-bold text-slate-900">Sem cadastro ou assinatura</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Uso totalmente gratuito e livre, sem criação de conta, planos pagos, mensalidades
                  ou sistema de créditos.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6 sm:col-span-2 lg:col-span-1">
                <Zap className="h-6 w-6 text-blue-600 mb-3" aria-hidden="true" />
                <h3 className="text-base font-bold text-slate-900">Memória limpa após uso</h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  Os buffers temporários são descartados assim que a conversão termina ou quando você
                  inicia um novo arquivo.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <div className="flex items-center gap-2 text-slate-900 font-semibold">
            <WordPdfLogo className="h-6 w-6" />
            <span>WordPDF – Conversor de Documentos</span>
          </div>

          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => handleModeChange('word-to-pdf', true)}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              Word para PDF
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('pdf-to-word', true)}
              className="hover:text-slate-900 transition-colors cursor-pointer"
            >
              PDF para Word
            </button>
          </div>

          <p className="text-xs text-slate-500">
            Processamento local no navegador · Gratuito e sem cadastro
          </p>
        </div>
      </footer>
    </div>
  );
}
