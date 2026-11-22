import {
  Check,
  Copy,
  Eye,
  Film,
  Link2,
  Pencil,
  Star,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import type { GiftRecord } from '../types/gift';

interface CreatorStudioProps {
  gifts: GiftRecord[];
  activeGift: GiftRecord | null;
  onGiftsChanged: (preferredGiftId?: string) => Promise<void>;
  onPreviewGift: (gift: GiftRecord) => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function formatDateAr(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

export default function CreatorStudio({
  gifts,
  activeGift,
  onGiftsChanged,
  onPreviewGift,
}: CreatorStudioProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Optional presentation text (everything important is inside the video)
  const [title, setTitle] = useState('هذه المفاجأة لك');
  const [recipientName, setRecipientName] = useState('');
  const [closingMessage, setClosingMessage] = useState('كل عام وأنت بألف خير');
  const [senderName, setSenderName] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);
  const [setPrimary, setSetPrimary] = useState(true);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeUploadIdRef = useRef<string | null>(null);

  // Share link copy state
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Inline delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Inline edit state
  const [editingGiftId, setEditingGiftId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editRecipient, setEditRecipient] = useState('');
  const [editClosing, setEditClosing] = useState('');
  const [editSender, setEditSender] = useState('');
  const [editDownload, setEditDownload] = useState(true);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const handleFilePicked = (file: File | undefined | null) => {
    if (!file) return;
    setUploadError(null);
    setUploadSuccessMsg(null);
    const validExtensions = ['.mp4', '.mov', '.webm', '.m4v', '.ogg', '.mkv'];
    const lowerName = file.name.toLowerCase();
    const hasValidExt = validExtensions.some((ext) => lowerName.endsWith(ext));
    if (!file.type.startsWith('video/') && !hasValidExt) {
      setUploadError('يرجى اختيار ملف فيديو صالح (MP4 أو MOV أو WebM).');
      return;
    }
    setSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    handleFilePicked(file);
  };

  const handleCancelUpload = async () => {
    abortControllerRef.current?.abort();
    const uploadId = activeUploadIdRef.current;
    activeUploadIdRef.current = null;
    setIsUploading(false);
    setUploadProgress(0);
    setUploadedBytes(0);
    if (uploadId) {
      fetch(`/api/uploads/${uploadId}`, { method: 'DELETE' }).catch(() => {});
    }
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setUploadError('اختر ملف الفيديو أولاً.');
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsUploading(true);
    setUploadProgress(0);
    setUploadedBytes(0);
    setUploadError(null);
    setUploadSuccessMsg(null);

    try {
      const initRes = await fetch('/api/uploads/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          originalName: selectedFile.name,
          mimeType: selectedFile.type || 'video/mp4',
          size: selectedFile.size,
          title: title.trim() || 'هذه المفاجأة لك',
          recipientName: recipientName.trim(),
          closingMessage: closingMessage.trim() || 'كل عام وأنت بألف خير',
          senderName: senderName.trim(),
          allowDownload,
          setPrimary,
        }),
      });

      if (!initRes.ok) {
        let message = `تعذر بدء رفع الفيديو (${initRes.status}).`;
        try {
          const errJson = (await initRes.json()) as { error?: string };
          if (errJson.error) message = errJson.error;
        } catch {
          // Keep status message
        }
        throw new Error(message);
      }

      const { uploadId, chunkSize } = (await initRes.json()) as {
        uploadId: string;
        chunkSize: number;
      };
      activeUploadIdRef.current = uploadId;

      const totalSize = selectedFile.size;
      const step = chunkSize || 4 * 1024 * 1024;
      let offset = 0;

      while (offset < totalSize) {
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const end = Math.min(offset + step, totalSize);
        const blob = selectedFile.slice(offset, end);

        let attempt = 0;
        let chunkUploaded = false;
        let lastChunkError = '';

        while (attempt < 3 && !chunkUploaded) {
          attempt += 1;
          try {
            const chunkRes = await fetch(
              `/api/uploads/${uploadId}/chunk?offset=${offset}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/octet-stream' },
                body: blob,
                signal: controller.signal,
              }
            );

            if (!chunkRes.ok) {
              let msg = `خطأ أثناء رفع جزء الفيديو (${chunkRes.status})`;
              try {
                const errData = (await chunkRes.json()) as { error?: string };
                if (errData.error) msg = errData.error;
              } catch {
                // Keep status message
              }
              lastChunkError = msg;
              await new Promise((r) => setTimeout(r, 400 * attempt));
              continue;
            }

            chunkUploaded = true;
          } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
              throw err;
            }
            lastChunkError =
              err instanceof Error ? err.message : 'انقطع الاتصال أثناء الرفع.';
            await new Promise((r) => setTimeout(r, 400 * attempt));
          }
        }

        if (!chunkUploaded) {
          throw new Error(lastChunkError || 'تعذر رفع أحد أجزاء الفيديو.');
        }

        offset = end;
        setUploadedBytes(offset);
        setUploadProgress(Math.min(99, Math.round((offset / totalSize) * 100)));
      }

      const completeRes = await fetch(`/api/uploads/${uploadId}/complete`, {
        method: 'POST',
        signal: controller.signal,
      });

      if (!completeRes.ok) {
        let msg = `تعذر إتمام حفظ الفيديو (${completeRes.status}).`;
        try {
          const errData = (await completeRes.json()) as { error?: string };
          if (errData.error) msg = errData.error;
        } catch {
          // Keep status message
        }
        throw new Error(msg);
      }

      const { gift } = (await completeRes.json()) as { gift: GiftRecord };
      activeUploadIdRef.current = null;
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploadProgress(100);
      setUploadSuccessMsg('تم حفظ الفيديو بنجاح وأصبح جاهزاً للإرسال.');
      await onGiftsChanged(gift.id);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setUploadError('تم إلغاء الرفع.');
      } else {
        setUploadError(
          err instanceof Error ? err.message : 'تعذر حفظ الفيديو على الخادم.'
        );
      }
    } finally {
      setIsUploading(false);
      abortControllerRef.current = null;
    }
  };

  const getShareUrl = useCallback((gift: GiftRecord) => {
    const base = window.location.origin;
    if (gift.isPrimary) {
      return `${base}/`;
    }
    return `${base}/?gift=${gift.id}`;
  }, []);

  const handleCopyShareLink = async (gift: GiftRecord) => {
    const url = getShareUrl(gift);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(gift.id);
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === gift.id ? null : prev));
      }, 2200);
    } catch {
      // Fallback copy
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedId(gift.id);
      window.setTimeout(() => {
        setCopiedId((prev) => (prev === gift.id ? null : prev));
      }, 2200);
    }
  };

  const handleSetPrimary = async (id: string) => {
    const res = await fetch(`/api/gifts/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isPrimary: true }),
    });
    if (res.ok) {
      await onGiftsChanged(id);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/gifts/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setConfirmDeleteId(null);
      await onGiftsChanged();
    }
  };

  const startEdit = (gift: GiftRecord) => {
    setEditingGiftId(gift.id);
    setEditTitle(gift.title);
    setEditRecipient(gift.recipientName);
    setEditClosing(gift.closingMessage);
    setEditSender(gift.senderName);
    setEditDownload(gift.allowDownload);
  };

  const handleSaveEdit = async (id: string) => {
    setIsSavingEdit(true);
    try {
      const res = await fetch(`/api/gifts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          recipientName: editRecipient,
          closingMessage: editClosing,
          senderName: editSender,
          allowDownload: editDownload,
        }),
      });
      if (res.ok) {
        setEditingGiftId(null);
        await onGiftsChanged(id);
      }
    } finally {
      setIsSavingEdit(false);
    }
  };

  const primaryOrLatest = activeGift ?? gifts[0] ?? null;

  return (
    <div className="min-h-screen bg-[#060608] text-[#F6F1E7] flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="border-b border-[#E5B869]/15 bg-[#09090C]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <a
            href="/"
            onClick={(e) => {
              if (primaryOrLatest) {
                e.preventDefault();
                onPreviewGift(primaryOrLatest);
              }
            }}
            className="font-display text-2xl font-bold text-[#F6F1E7] whitespace-nowrap shrink-0"
          >
            ذِكرى
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm text-[#A69D8E]">
            <a
              href="#upload-section"
              className="hover:text-[#F6F1E7] transition-colors whitespace-nowrap shrink-0"
            >
              رفع فيديو
            </a>
            <a
              href="#library-section"
              className="hover:text-[#F6F1E7] transition-colors whitespace-nowrap shrink-0"
            >
              المكتبة المحفوظة
            </a>
            {primaryOrLatest && (
              <a
                href="#share-section"
                className="hover:text-[#F6F1E7] transition-colors whitespace-nowrap shrink-0"
              >
                رابط المفاجأة
              </a>
            )}
          </nav>

          <div className="flex items-center shrink-0">
            {primaryOrLatest ? (
              <button
                type="button"
                onClick={() => onPreviewGift(primaryOrLatest)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#E5B869] text-[#09080A] text-sm font-semibold hover:bg-[#EFC77E] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                <span>معاينة المفاجأة</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#E5B869] text-[#09080A] text-sm font-semibold hover:bg-[#EFC77E] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <UploadCloud className="w-4 h-4" />
                <span>اختر الفيديو</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 md:py-14">
        {/* Studio Intro */}
        <div className="max-w-2xl mb-12">
          <p className="text-xs md:text-sm text-[#E5B869] mb-3">
            صالة الإعداد والحفظ الدائم
          </p>
          <h1
            className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-[#F6F1E7] leading-[1.25] mb-4"
            style={{ textWrap: 'balance' }}
          >
            جهّز فيديو عيد الميلاد في عرض سينمائي خاص
          </h1>
          <p className="text-sm sm:text-base text-[#A69D8E] leading-relaxed">
            ارفع الفيديو بجودته الكاملة ليُحفظ دائماً على الموقع. وعند إرسال الرابط لصاحب الهدية، سيظهر له غلاف مفاجأة أنيق يفتح الفيديو بدقة عالية وينتهي بختام احتفالي هادئ.
          </p>
        </div>

        {/* Share Ready Banner (when a gift is saved) */}
        {primaryOrLatest && (
          <section
            id="share-section"
            className="mb-12 p-6 sm:p-8 rounded-2xl bg-[#101014] border border-[#E5B869]/25 flex flex-col lg:flex-row lg:items-center justify-between gap-6"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-[#E5B869] mb-2">
                <Link2 className="w-4 h-4 shrink-0" />
                <span>الرابط جاهز للإرسال</span>
              </div>
              <p className="text-base sm:text-lg font-medium text-[#F6F1E7] mb-1 truncate">
                {primaryOrLatest.title}
                {primaryOrLatest.recipientName ? ` — إلى ${primaryOrLatest.recipientName}` : ''}
              </p>
              <p dir="ltr" className="text-xs sm:text-sm text-[#A69D8E] truncate text-right">
                {getShareUrl(primaryOrLatest)}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => handleCopyShareLink(primaryOrLatest)}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-[#E5B869] text-[#09080A] text-sm font-semibold hover:bg-[#EFC77E] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedId === primaryOrLatest.id ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>تم نسخ الرابط</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>نسخ رابط المفاجأة</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => onPreviewGift(primaryOrLatest)}
                className="inline-flex items-center gap-2 px-5 py-3 rounded-lg border border-[#E5B869]/30 text-[#F6F1E7] text-sm font-medium hover:bg-white/5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Eye className="w-4 h-4 text-[#E5B869]" />
                <span>تجربة العرض كما يراه المُستلم</span>
              </button>
            </div>
          </section>
        )}

        {/* Main 2-Column Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          {/* Upload Column */}
          <section id="upload-section" className="lg:col-span-6">
            <form
              onSubmit={handleUploadSubmit}
              className="p-6 sm:p-8 rounded-2xl bg-[#101014] border border-white/10 space-y-6"
            >
              <div>
                <h2 className="text-lg font-semibold text-[#F6F1E7] mb-1">
                  رفع فيديو الإهداء
                </h2>
                <p className="text-xs sm:text-sm text-[#A69D8E]">
                  يُحفظ الملف بأبعاده وجودته الأصلية دون أي ضغط أو تقليل للدقة.
                </p>
              </div>

              {/* Dropzone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => !isUploading && fileInputRef.current?.click()}
                className={`relative rounded-xl border border-dashed p-8 text-center transition-colors cursor-pointer ${
                  isDragging
                    ? 'border-[#E5B869] bg-[#E5B869]/10'
                    : selectedFile
                    ? 'border-[#E5B869]/50 bg-[#151419]'
                    : 'border-white/20 bg-[#0B0B0E] hover:border-[#E5B869]/50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/x-m4v,video/*"
                  onChange={(e) => handleFilePicked(e.target.files?.[0])}
                  className="hidden"
                />

                <div className="w-12 h-12 rounded-full bg-[#E5B869]/12 text-[#E5B869] flex items-center justify-center mx-auto mb-4">
                  {selectedFile ? <Film className="w-6 h-6" /> : <UploadCloud className="w-6 h-6" />}
                </div>

                {selectedFile ? (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-[#F6F1E7] truncate max-w-full px-2">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-[#A69D8E] tabular-nums">
                      {formatBytes(selectedFile.size)} · جاهز للحفظ بالجودة الأصلية
                    </p>
                    <p className="text-xs text-[#E5B869] pt-1">اضغط لتغيير الملف</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-[#F6F1E7]">
                      اسحب الفيديو هنا أو اضغط لاختياره
                    </p>
                    <p className="text-xs text-[#A69D8E]">
                      يدعم MP4 و MOV و WebM حتى 2 جيجابايت
                    </p>
                  </div>
                )}
              </div>

              {/* Optional minimal titles (since main text is inside the video) */}
              <div className="space-y-4 pt-2 border-t border-white/10">
                <p className="text-xs text-[#A69D8E]">
                  إعدادات الغلاف والختام (اختيارية — اتركها كما هي إن كان كل شيء مكتوباً داخل الفيديو)
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block space-y-1.5">
                    <span className="text-xs text-[#D8CEBE]">عنوان الغلاف</span>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="هذه المفاجأة لك"
                      className="w-full px-3.5 py-2.5 rounded-lg bg-[#08080A] border border-white/12 text-sm text-[#F6F1E7] placeholder:text-[#6E675C] focus:outline-none focus:border-[#E5B869]"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-xs text-[#D8CEBE]">اسم المُهدى إليه (اختياري)</span>
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="مثال: سارة"
                      className="w-full px-3.5 py-2.5 rounded-lg bg-[#08080A] border border-white/12 text-sm text-[#F6F1E7] placeholder:text-[#6E675C] focus:outline-none focus:border-[#E5B869]"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block space-y-1.5">
                    <span className="text-xs text-[#D8CEBE]">عبارة الختام</span>
                    <input
                      type="text"
                      value={closingMessage}
                      onChange={(e) => setClosingMessage(e.target.value)}
                      placeholder="كل عام وأنت بألف خير"
                      className="w-full px-3.5 py-2.5 rounded-lg bg-[#08080A] border border-white/12 text-sm text-[#F6F1E7] placeholder:text-[#6E675C] focus:outline-none focus:border-[#E5B869]"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-xs text-[#D8CEBE]">توقيع المُهدي (اختياري)</span>
                    <input
                      type="text"
                      value={senderName}
                      onChange={(e) => setSenderName(e.target.value)}
                      placeholder="اتركه فارغاً إذا كان التوقيع بالفيديو"
                      className="w-full px-3.5 py-2.5 rounded-lg bg-[#08080A] border border-white/12 text-sm text-[#F6F1E7] placeholder:text-[#6E675C] focus:outline-none focus:border-[#E5B869]"
                    />
                  </label>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                  <label className="inline-flex items-center gap-2.5 text-xs sm:text-sm text-[#D8CEBE] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowDownload}
                      onChange={(e) => setAllowDownload(e.target.checked)}
                      className="w-4 h-4 accent-[#E5B869] rounded"
                    />
                    <span>السماح للمُستلم بحفظ الفيديو في الختام</span>
                  </label>

                  <label className="inline-flex items-center gap-2.5 text-xs sm:text-sm text-[#D8CEBE] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={setPrimary}
                      onChange={(e) => setSetPrimary(e.target.checked)}
                      className="w-4 h-4 accent-[#E5B869] rounded"
                    />
                    <span>عرضه مباشرة على الرابط الرئيسي</span>
                  </label>
                </div>
              </div>

              {/* Upload Progress */}
              {isUploading && selectedFile && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-[#D8CEBE]">
                    <span>
                      جاري رفع وحفظ الفيديو ({formatBytes(uploadedBytes)} / {formatBytes(selectedFile.size)})
                    </span>
                    <span className="tabular-nums font-medium">{uploadProgress}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-[#E5B869] transition-all duration-150"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {uploadError && (
                <p role="alert" className="text-xs sm:text-sm text-rose-400">
                  {uploadError}
                </p>
              )}

              {uploadSuccessMsg && (
                <p role="status" className="text-xs sm:text-sm text-emerald-400">
                  {uploadSuccessMsg}
                </p>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={isUploading || !selectedFile}
                  className="flex-1 py-3.5 px-6 rounded-lg bg-[#E5B869] text-[#09080A] font-semibold text-sm sm:text-base hover:bg-[#EFC77E] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {isUploading ? 'جاري الحفظ الدائم...' : 'حفظ الفيديو وتجهيز رابط المفاجأة'}
                </button>

                {isUploading && (
                  <button
                    type="button"
                    onClick={handleCancelUpload}
                    className="py-3.5 px-5 rounded-lg border border-white/15 text-sm text-[#D8CEBE] hover:bg-white/5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    إلغاء
                  </button>
                )}
              </div>
            </form>
          </section>

          {/* Saved Library Column */}
          <section id="library-section" className="lg:col-span-6 space-y-5">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold text-[#F6F1E7]">
                الفيديوهات المحفوظة
              </h2>
              <span className="text-xs text-[#A69D8E] tabular-nums">
                {gifts.length} {gifts.length === 1 ? 'فيديو' : 'فيديوهات'}
              </span>
            </div>

            {gifts.length === 0 ? (
              <div className="p-8 rounded-2xl bg-[#101014] border border-white/10 text-center">
                <Film className="w-8 h-8 text-[#6E675C] mx-auto mb-3" />
                <p className="text-sm text-[#D8CEBE] mb-1">
                  لا توجد فيديوهات محفوظة بعد
                </p>
                <p className="text-xs text-[#A69D8E]">
                  بمجرد رفع الفيديو الأول، سيظهر هنا مع رابط المفاجأة الدائم الخاص به.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {gifts.map((gift) => {
                  const isEditing = editingGiftId === gift.id;
                  const isConfirmingDelete = confirmDeleteId === gift.id;

                  return (
                    <article
                      key={gift.id}
                      className="p-6 rounded-2xl bg-[#101014] border border-white/10 space-y-4"
                    >
                      {isEditing ? (
                        <div className="space-y-4">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-[#F6F1E7]">
                              تعديل بيانات الغلاف والختام
                            </h3>
                            <button
                              type="button"
                              onClick={() => setEditingGiftId(null)}
                              aria-label="إغلاق التعديل"
                              className="p-1.5 text-[#A69D8E] hover:text-[#F6F1E7] cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              placeholder="عنوان الغلاف"
                              className="px-3 py-2 rounded-lg bg-[#08080A] border border-white/12 text-sm text-[#F6F1E7]"
                            />
                            <input
                              type="text"
                              value={editRecipient}
                              onChange={(e) => setEditRecipient(e.target.value)}
                              placeholder="اسم المُهدى إليه"
                              className="px-3 py-2 rounded-lg bg-[#08080A] border border-white/12 text-sm text-[#F6F1E7]"
                            />
                            <input
                              type="text"
                              value={editClosing}
                              onChange={(e) => setEditClosing(e.target.value)}
                              placeholder="عبارة الختام"
                              className="px-3 py-2 rounded-lg bg-[#08080A] border border-white/12 text-sm text-[#F6F1E7]"
                            />
                            <input
                              type="text"
                              value={editSender}
                              onChange={(e) => setEditSender(e.target.value)}
                              placeholder="توقيع المُهدي"
                              className="px-3 py-2 rounded-lg bg-[#08080A] border border-white/12 text-sm text-[#F6F1E7]"
                            />
                          </div>

                          <label className="inline-flex items-center gap-2 text-xs text-[#D8CEBE] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editDownload}
                              onChange={(e) => setEditDownload(e.target.checked)}
                              className="w-4 h-4 accent-[#E5B869]"
                            />
                            <span>السماح بتحميل الفيديو بالجودة الكاملة</span>
                          </label>

                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              disabled={isSavingEdit}
                              onClick={() => handleSaveEdit(gift.id)}
                              className="px-4 py-2 rounded-lg bg-[#E5B869] text-[#09080A] text-xs font-semibold hover:bg-[#EFC77E] cursor-pointer"
                            >
                              {isSavingEdit ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingGiftId(null)}
                              className="px-4 py-2 rounded-lg border border-white/15 text-xs text-[#D8CEBE] hover:bg-white/5 cursor-pointer"
                            >
                              إلغاء
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <h3 className="text-base font-semibold text-[#F6F1E7] truncate">
                                {gift.title}
                                {gift.recipientName ? ` · إلى ${gift.recipientName}` : ''}
                              </h3>
                              {/* Unboxed metadata with typographic separators */}
                              <div className="flex flex-wrap items-center gap-2 text-xs text-[#A69D8E] mt-1.5 tabular-nums">
                                <span className="truncate max-w-[180px]">{gift.originalName}</span>
                                <span aria-hidden="true">·</span>
                                <span>{formatBytes(gift.size)}</span>
                                <span aria-hidden="true">·</span>
                                <span>{formatDateAr(gift.createdAt)}</span>
                                {gift.isPrimary && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-[#E5B869] font-medium">
                                      الهدية الرئيسية على الرابط العام
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-white/8">
                            <button
                              type="button"
                              onClick={() => onPreviewGift(gift)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#E5B869] text-[#09080A] text-xs font-semibold hover:bg-[#EFC77E] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>معاينة</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCopyShareLink(gift)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/15 text-[#F6F1E7] text-xs font-medium hover:bg-white/5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              {copiedId === gift.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>تم النسخ</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5 text-[#E5B869]" />
                                  <span>نسخ الرابط</span>
                                </>
                              )}
                            </button>

                            {!gift.isPrimary && (
                              <button
                                type="button"
                                onClick={() => handleSetPrimary(gift.id)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/15 text-[#D8CEBE] text-xs font-medium hover:bg-white/5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Star className="w-3.5 h-3.5 text-[#E5B869]" />
                                <span>تعيين كرئيسية</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => startEdit(gift)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[#A69D8E] hover:text-[#F6F1E7] hover:bg-white/5 text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              <span>تعديل</span>
                            </button>

                            {isConfirmingDelete ? (
                              <div className="flex items-center gap-2 ms-auto">
                                <button
                                  type="button"
                                  onClick={() => handleDelete(gift.id)}
                                  className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-500 cursor-pointer"
                                >
                                  تأكيد الحذف
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2.5 py-1.5 text-xs text-[#A69D8E] hover:text-[#F6F1E7] cursor-pointer"
                                >
                                  إلغاء
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(gift.id)}
                                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-[#A69D8E] hover:text-rose-400 hover:bg-white/5 text-xs transition-colors ms-auto whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>حذف</span>
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
