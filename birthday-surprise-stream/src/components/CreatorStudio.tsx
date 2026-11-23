import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  Film,
  Link2,
  Lock,
  LogOut,
  Pencil,
  ShieldCheck,
  Star,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  auth,
  FIREBASE_CONSOLE_DB_URL,
  FIREBASE_PRICING_URL,
  googleProvider,
  isFirestoreQuotaExhaustedFlag,
} from '../firebase';
import {
  createGiftFromExternalUrl,
  deleteGiftPermanently,
  fetchCreatorGifts,
  setGiftAsPrimary,
  updateGiftMetadata,
  uploadGiftFileToServer,
} from '../services/giftStore';
import type { GiftRecord } from '../types/gift';

interface CreatorStudioProps {
  onPreviewGift: (gift: GiftRecord) => void;
}

const OWNER_EMAIL = 'ba.aldeen@gmail.com';

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

export default function CreatorStudio({ onPreviewGift }: CreatorStudioProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  const [gifts, setGifts] = useState<GiftRecord[]>([]);
  const [loadingGifts, setLoadingGifts] = useState(false);
  const [quotaExceededNotice, setQuotaExceededNotice] = useState(
    isFirestoreQuotaExhaustedFlag()
  );

  const [uploadMode, setUploadMode] = useState<'file' | 'url'>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [externalVideoUrl, setExternalVideoUrl] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Optional presentation text
  const [title, setTitle] = useState('هذه المفاجأة لك');
  const [recipientName, setRecipientName] = useState('');
  const [closingMessage, setClosingMessage] = useState('كل عام وأنت بألف خير');
  const [senderName, setSenderName] = useState('');
  const [allowDownload, setAllowDownload] = useState(true);
  const [setPrimary, setSetPrimary] = useState(true);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [uploadSpeedText, setUploadSpeedText] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const uploadStartMsRef = useRef<number>(0);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  // Inline edit state
  const [editingGiftId, setEditingGiftId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editRecipient, setEditRecipient] = useState('');
  const [editClosing, setEditClosing] = useState('');
  const [editSender, setEditSender] = useState('');
  const [editDownload, setEditDownload] = useState(true);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const loadGiftsList = useCallback(async (currentUser: User) => {
    setLoadingGifts(true);
    try {
      const { gifts: list, quotaExceeded } = await fetchCreatorGifts(
        currentUser.email,
        currentUser.uid
      );
      setGifts(list);
      setQuotaExceededNotice(quotaExceeded);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingGifts(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (nextUser) {
        loadGiftsList(nextUser);
      } else {
        setGifts([]);
      }
    });
    return () => unsub();
  }, [loadGiftsList]);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'تعذر تسجيل الدخول، يرجى المحاولة مرة أخرى.'
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

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

  const handleCancelUpload = () => {
    abortControllerRef.current?.abort();
    setIsUploading(false);
    setUploadProgress(0);
    setUploadedBytes(0);
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const shouldBePrimary = setPrimary || gifts.filter((g) => g.status === 'ready').length === 0;

    if (uploadMode === 'url') {
      const trimmedUrl = externalVideoUrl.trim();
      if (!trimmedUrl || !/^https?:\/\/.+/i.test(trimmedUrl)) {
        setUploadError('يرجى إدخال رابط فيديو صحيح يبدأ بـ http أو https.');
        return;
      }

      setIsUploading(true);
      setUploadError(null);
      setUploadSuccessMsg(null);
      try {
        const result = await createGiftFromExternalUrl({
          videoUrl: trimmedUrl,
          title,
          recipientName,
          closingMessage,
          senderName,
          allowDownload,
          setPrimary: shouldBePrimary,
        });
        setExternalVideoUrl('');
        setQuotaExceededNotice(result.quotaExceeded);
        setUploadSuccessMsg(
          result.firestoreSynced
            ? 'تم ربط الفيديو وتثبيته بشكل دائم في السحابة ولن يُحذف أبداً إلا إذا حذفته بنفسك.'
            : 'تم ربط الفيديو على الخادم وهو جاهز للعرض فوراً.'
        );
        await loadGiftsList(user);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'تعذر حفظ رابط الفيديو.');
      } finally {
        setIsUploading(false);
      }
      return;
    }

    if (!selectedFile) {
      setUploadError('اختر ملف الفيديو أولاً.');
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    uploadStartMsRef.current = performance.now();
    setIsUploading(true);
    setUploadProgress(0);
    setUploadedBytes(0);
    setUploadSpeedText('');
    setUploadError(null);
    setUploadSuccessMsg(null);

    try {
      await uploadGiftFileToServer({
        file: selectedFile,
        title,
        recipientName,
        closingMessage,
        senderName,
        allowDownload,
        setPrimary: shouldBePrimary,
        signal: controller.signal,
        onProgress: (uploaded, total) => {
          setUploadedBytes(uploaded);
          setUploadProgress(Math.min(99, Math.round((uploaded / total) * 100)));
          const elapsedSec = Math.max(0.2, (performance.now() - uploadStartMsRef.current) / 1000);
          const bytesPerSec = uploaded / elapsedSec;
          if (bytesPerSec >= 1024 * 1024) {
            setUploadSpeedText(`${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`);
          } else {
            setUploadSpeedText(`${Math.round(bytesPerSec / 1024)} KB/s`);
          }
        },
      });

      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setUploadProgress(100);
      setUploadSuccessMsg('تم رفع الفيديو وحفظه بنجاح، وهو جاهز للعرض الآن.');
      await loadGiftsList(user);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setUploadError('تم إلغاء الرفع.');
      } else {
        setUploadError(
          err instanceof Error ? err.message : 'تعذر رفع الفيديو إلى الخادم.'
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
    return `${base}/g/${gift.id}`;
  }, []);

  const handleCopyShareLink = async (gift: GiftRecord) => {
    const url = getShareUrl(gift);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopiedId(gift.id);
    window.setTimeout(() => {
      setCopiedId((prev) => (prev === gift.id ? null : prev));
    }, 2200);
  };

  const handleSetPrimary = async (id: string) => {
    if (!user) return;
    await setGiftAsPrimary(id, gifts);
    await loadGiftsList(user);
  };

  const handleDelete = async (gift: GiftRecord) => {
    if (!user) return;
    setIsDeletingId(gift.id);
    try {
      await deleteGiftPermanently(gift.id);
      setConfirmDeleteId(null);
      await loadGiftsList(user);
    } finally {
      setIsDeletingId(null);
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
    if (!user) return;
    setIsSavingEdit(true);
    try {
      await updateGiftMetadata(id, {
        title: editTitle,
        recipientName: editRecipient,
        closingMessage: editClosing,
        senderName: editSender,
        allowDownload: editDownload,
      });
      setEditingGiftId(null);
      await loadGiftsList(user);
    } finally {
      setIsSavingEdit(false);
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#060608] text-[#F6F1E7] flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-[#E5B869]/25 border-t-[#E5B869] animate-spin" />
      </div>
    );
  }

  const isAuthorizedOwner = Boolean(user && user.email === OWNER_EMAIL);

  if (!user || !isAuthorizedOwner) {
    return (
      <div className="min-h-screen bg-[#060608] text-[#F6F1E7] flex flex-col items-center justify-center px-6 py-12">
        <div className="max-w-md w-full p-8 rounded-2xl bg-[#101014] border border-[#E5B869]/20 text-center space-y-6">
          <div className="w-14 h-14 rounded-full bg-[#E5B869]/12 text-[#E5B869] flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>

          <div className="space-y-2">
            <h1 className="font-display text-3xl font-bold text-[#F6F1E7]">
              صفحة رفع وحفظ الفيديو
            </h1>
            <p className="text-sm text-[#A69D8E] leading-relaxed">
              هذه الصفحة مفصولة تماماً عن رابط العرض الرئيسي ومحمية بحسابك الشخصي حتى لا يتمكن أحد سواك من إضافة أو حذف الفيديو.
            </p>
          </div>

          {user && !isAuthorizedOwner ? (
            <div className="space-y-4">
              <p className="text-xs sm:text-sm text-rose-400">
                الحساب الحالي ({user.email}) غير مصرح له بإدارة الإهداءات. يرجى تسجيل الدخول بحساب المالك ({OWNER_EMAIL}).
              </p>
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full py-3 px-5 rounded-lg border border-white/15 text-sm text-[#F6F1E7] hover:bg-white/5 transition-colors cursor-pointer"
              >
                تسجيل الخروج
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={isSigningIn}
              onClick={handleGoogleSignIn}
              className="w-full py-3.5 px-6 rounded-lg bg-[#E5B869] text-[#09080A] font-semibold text-sm sm:text-base hover:bg-[#EFC77E] disabled:opacity-60 transition-colors cursor-pointer"
            >
              {isSigningIn ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول بحساب Google'}
            </button>
          )}

          {authError && (
            <p role="alert" className="text-xs text-rose-400">
              {authError}
            </p>
          )}
        </div>
      </div>
    );
  }

  const primaryOrLatest = gifts.find((g) => g.isPrimary && g.status === 'ready') ?? gifts[0] ?? null;

  return (
    <div className="min-h-screen bg-[#060608] text-[#F6F1E7] flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="border-b border-[#E5B869]/15 bg-[#09090C]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <span className="font-display text-2xl font-bold text-[#F6F1E7] whitespace-nowrap shrink-0">
            ذِكرى
          </span>

          <nav className="hidden md:flex items-center gap-6 text-sm text-[#A69D8E]">
            <a
              href="#upload-section"
              className="hover:text-[#F6F1E7] transition-colors whitespace-nowrap shrink-0"
            >
              رفع فيديو دائم
            </a>
            <a
              href="#library-section"
              className="hover:text-[#F6F1E7] transition-colors whitespace-nowrap shrink-0"
            >
              الفيديوهات المثبتة
            </a>
            <a
              href="#guide-section"
              className="hover:text-[#F6F1E7] transition-colors whitespace-nowrap shrink-0"
            >
              التشغيل والمشاركة
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            {primaryOrLatest ? (
              <button
                type="button"
                onClick={() => onPreviewGift(primaryOrLatest)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#E5B869] text-[#09080A] text-sm font-semibold hover:bg-[#EFC77E] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                <span>فتح صفحة العرض</span>
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
        {/* Studio Intro + Account Status */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div className="max-w-2xl">
            <p className="text-xs md:text-sm text-[#E5B869] mb-3">
              بوابة المُهدي الخاصة · تخزين سحابي دائم
            </p>
            <h1
              className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-[#F6F1E7] leading-[1.25] mb-3"
              style={{ textWrap: 'balance' }}
            >
              رفع وتثبيت فيديو المفاجأة بشكل دائم
            </h1>
            <p className="text-sm sm:text-base text-[#A69D8E] leading-relaxed">
              يتم حفظ الفيديو هنا في قاعدة البيانات السحابية الدائمة ولا يُحذف أبداً إلا إذا قمت بحذفه بنفسك. كما أن هذه الصفحة مفصولة تماماً عن رابط العرض الرئيسي الذي ترسله للمُستلم.
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs text-[#A69D8E] shrink-0">
            <ShieldCheck className="w-4 h-4 text-[#E5B869]" />
            <span>{user.email}</span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-1 text-[#D8CEBE] hover:text-[#F6F1E7] cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>خروج</span>
            </button>
          </div>
        </div>

        {/* Share Ready Banner */}
        {primaryOrLatest && (
          <section
            id="share-section"
            className="mb-12 p-6 sm:p-8 rounded-2xl bg-[#101014] border border-[#E5B869]/25 flex flex-col lg:flex-row lg:items-center justify-between gap-6"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-[#E5B869] mb-2">
                <Link2 className="w-4 h-4 shrink-0" />
                <span>رابط العرض الرئيسي (لإرساله إلى الشخص فقط — لا يحتوي على صفحة الرفع)</span>
              </div>
              <p className="text-base sm:text-lg font-medium text-[#F6F1E7] mb-1 truncate">
                {primaryOrLatest.title}
                {primaryOrLatest.recipientName ? ` · ${primaryOrLatest.recipientName}` : ''}
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
                <span>معاينة العرض</span>
              </button>
            </div>
          </section>
        )}

        {/* Firestore Daily Free Quota Notice (non-blocking — server upload & URL streaming remain active) */}
        {quotaExceededNotice && (
          <section
            role="status"
            className="mb-8 p-5 rounded-2xl bg-[#16120B] border border-[#E5B869]/35 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-[#E5B869] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-[#F6F1E7]">
                  بلغت قاعدة بيانات Firestore حد الكتابة المجاني اليومي — ويتجدد الحد تلقائياً غداً.
                </p>
                <p className="text-xs text-[#A69D8E] leading-relaxed">
                  يمكنك رفع الفيديو وتشغيله ومشاركته الآن عبر الخادم مباشرة بدون توقف. ولتثبيت الروابط الدائمة في السحابة بعد تجدد الحصة أو ترقية الباقة يمكنك مراجعة{' '}
                  <a
                    href={FIREBASE_PRICING_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#E5B869] underline underline-offset-4"
                  >
                    خطة Spark / تسعير Firestore
                  </a>{' '}
                  أو{' '}
                  <a
                    href={FIREBASE_CONSOLE_DB_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#E5B869] underline underline-offset-4"
                  >
                    ترقية قاعدة البيانات
                  </a>
                  .
                </p>
              </div>
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
                  إضافة فيديو المفاجأة
                </h2>
                <p className="text-xs sm:text-sm text-[#A69D8E]">
                  ارفع الفيديو مباشرة من جهازك بسرعة عالية، أو اربطه برابط دائم من Google Drive / رابط مباشر.
                </p>
              </div>

              {/* Source Mode Switcher */}
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#08080A] border border-white/10">
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => {
                    setUploadMode('file');
                    setUploadError(null);
                  }}
                  className={`py-2.5 px-3 rounded-lg text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                    uploadMode === 'file'
                      ? 'bg-[#E5B869] text-[#09080A] font-semibold'
                      : 'text-[#A69D8E] hover:text-[#F6F1E7]'
                  }`}
                >
                  رفع ملف من الجهاز
                </button>
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => {
                    setUploadMode('url');
                    setUploadError(null);
                  }}
                  className={`py-2.5 px-3 rounded-lg text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                    uploadMode === 'url'
                      ? 'bg-[#E5B869] text-[#09080A] font-semibold'
                      : 'text-[#A69D8E] hover:text-[#F6F1E7]'
                  }`}
                >
                  رابط دائم (Google Drive)
                </button>
              </div>

              {uploadMode === 'file' ? (
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
                        {formatBytes(selectedFile.size)} · جاهز للرفع السريع بالجودة الأصلية
                      </p>
                      <p className="text-xs text-[#E5B869] pt-1">اضغط لتغيير الملف</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium text-[#F6F1E7]">
                        اسحب الفيديو هنا أو اضغط لاختياره
                      </p>
                      <p className="text-xs text-[#A69D8E]">
                        يدعم MP4 و MOV و WebM بالجودة العالية حتى 2 جيجابايت
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-white/10 bg-[#0B0B0E] p-5">
                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-[#D8CEBE]">
                      رابط الفيديو (Google Drive عام أو رابط MP4 مباشر)
                    </span>
                    <input
                      type="url"
                      dir="ltr"
                      value={externalVideoUrl}
                      onChange={(e) => setExternalVideoUrl(e.target.value)}
                      placeholder="https://drive.google.com/file/d/.../view"
                      className="w-full px-3.5 py-2.5 rounded-lg bg-[#060608] border border-white/15 text-sm text-[#F6F1E7] placeholder:text-[#6E675C] focus:outline-none focus:border-[#E5B869]"
                    />
                  </label>
                  <p className="text-xs text-[#A69D8E] leading-relaxed">
                    لضمان بقاء الفيديو للأبد بدون أي حذف عند إعادة تشغيل الخادم: ارفع الفيديو في Google Drive ثم اختر مشاركة{' '}
                    <span className="text-[#F6F1E7]">«أي شخص لديه الرابط»</span> وضع الرابط هنا.
                  </p>
                </div>
              )}

              {/* Optional minimal titles */}
              <div className="space-y-4 pt-2 border-t border-white/10">
                <p className="text-xs text-[#A69D8E]">
                  إعدادات الغلاف والختام (اختيارية)
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
                    <span className="text-xs text-[#D8CEBE]">الاسم الظاهر على الغلاف</span>
                    <input
                      type="text"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      placeholder="مثال: حبيبتي"
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
                    <span>السماح بحفظ الفيديو في الختام</span>
                  </label>

                  <label className="inline-flex items-center gap-2.5 text-xs sm:text-sm text-[#D8CEBE] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={setPrimary}
                      onChange={(e) => setSetPrimary(e.target.checked)}
                      className="w-4 h-4 accent-[#E5B869] rounded"
                    />
                    <span>تعيينه على رابط العرض الرئيسي</span>
                  </label>
                </div>
              </div>

              {/* Upload Progress */}
              {isUploading && uploadMode === 'file' && selectedFile && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-[#D8CEBE]">
                    <span>
                      جاري الرفع ({formatBytes(uploadedBytes)} / {formatBytes(selectedFile.size)})
                      {uploadSpeedText ? ` · ${uploadSpeedText}` : ''}
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
                  disabled={
                    isUploading ||
                    (uploadMode === 'file' ? !selectedFile : !externalVideoUrl.trim())
                  }
                  className="flex-1 py-3.5 px-6 rounded-lg bg-[#E5B869] text-[#09080A] font-semibold text-sm sm:text-base hover:bg-[#EFC77E] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {isUploading
                    ? uploadMode === 'file'
                      ? 'جاري الرفع...'
                      : 'جاري الحفظ...'
                    : uploadMode === 'file'
                    ? 'رفع الفيديو وتثبيته الآن'
                    : 'حفظ وتثبيت الرابط الدائم'}
                </button>

                {isUploading && uploadMode === 'file' && (
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
                الفيديوهات المثبتة (لا تُحذف تلقائياً)
              </h2>
              <span className="text-xs text-[#A69D8E] tabular-nums">
                {gifts.length} {gifts.length === 1 ? 'فيديو' : 'فيديوهات'}
              </span>
            </div>

            {loadingGifts ? (
              <div className="p-8 rounded-2xl bg-[#101014] border border-white/10 text-center">
                <div className="w-8 h-8 rounded-full border-2 border-[#E5B869]/25 border-t-[#E5B869] animate-spin mx-auto mb-3" />
                <p className="text-xs text-[#A69D8E]">جاري تحميل القائمة المحفوظة...</p>
              </div>
            ) : gifts.length === 0 ? (
              <div className="p-8 rounded-2xl bg-[#101014] border border-white/10 text-center">
                <Film className="w-8 h-8 text-[#6E675C] mx-auto mb-3" />
                <p className="text-sm text-[#D8CEBE] mb-1">
                  لا توجد فيديوهات مثبتة بعد
                </p>
                <p className="text-xs text-[#A69D8E]">
                  ارفع الفيديو من النموذج المجاور ليُحفظ دائماً في السحابة ويصبح جاهزاً للإرسال.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {gifts.map((gift) => {
                  const isEditing = editingGiftId === gift.id;
                  const isConfirmingDelete = confirmDeleteId === gift.id;
                  const isDeleting = isDeletingId === gift.id;

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
                              placeholder="الاسم على الغلاف"
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
                                {gift.recipientName ? ` · ${gift.recipientName}` : ''}
                              </h3>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-[#A69D8E] mt-1.5 tabular-nums">
                                <span className="truncate max-w-[180px]">{gift.originalName}</span>
                                {gift.size > 0 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>{formatBytes(gift.size)}</span>
                                  </>
                                )}
                                <span aria-hidden="true">·</span>
                                <span>{gift.sourceType === 'url' ? 'رابط دائم' : 'ملف على الخادم'}</span>
                                <span aria-hidden="true">·</span>
                                <span>{formatDateAr(gift.createdAt)}</span>
                                {gift.status === 'ready' && gift.isPrimary && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-[#E5B869] font-medium">
                                      مثبت على الرابط الرئيسي
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-white/8">
                            {gift.status === 'ready' && (
                              <>
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
                              </>
                            )}

                            {gift.status === 'ready' && !gift.isPrimary && (
                              <button
                                type="button"
                                onClick={() => handleSetPrimary(gift.id)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/15 text-[#D8CEBE] text-xs font-medium hover:bg-white/5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Star className="w-3.5 h-3.5 text-[#E5B869]" />
                                <span>تعيين كرئيسي</span>
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
                                  disabled={isDeleting}
                                  onClick={() => handleDelete(gift)}
                                  className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-500 disabled:opacity-60 cursor-pointer"
                                >
                                  {isDeleting ? 'جاري الحذف...' : 'تأكيد الحذف'}
                                </button>
                                <button
                                  type="button"
                                  disabled={isDeleting}
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

        {/* Guide for local computer run & sharing link */}
        <section
          id="guide-section"
          className="mt-14 pt-10 border-t border-white/10 grid grid-cols-1 md:grid-cols-2 gap-8"
        >
          <div className="space-y-2.5">
            <h3 className="text-base font-semibold text-[#F6F1E7]">
              كيف ترسل الرابط للشخص؟
            </h3>
            <p className="text-xs sm:text-sm text-[#A69D8E] leading-relaxed">
              بعد رفع الفيديو هنا في <span dir="ltr">/studio</span>، اضغط على زر <strong className="text-[#F6F1E7]">«نسخ الرابط»</strong> وأرسله للشخص مباشرة (عبر رابط التطبيق المشارك <span dir="ltr">Shared App URL</span>). عند فتحه، لن يرى سوى غلاف المفاجأة والفيديو والختام، ولا يمكنه رؤية صفحة الرفع أبداً.
            </p>
          </div>

          <div className="space-y-2.5">
            <h3 className="text-base font-semibold text-[#F6F1E7]">
              كيف تفتح الكود على الكمبيوتر إذا قمت بتحميله؟
            </h3>
            <p className="text-xs sm:text-sm text-[#A69D8E] leading-relaxed">
              ثبّت <span dir="ltr">Node.js</span> ثم افتح مجلد المشروع في الطرفية ونفّذ <span dir="ltr">npm install</span> ثم <span dir="ltr">npm run dev</span> وافتح <span dir="ltr">http://localhost:3000</span> للعرض أو <span dir="ltr">http://localhost:3000/studio</span> لإدارة الفيديوهات. ولإرسال رابط يفتحه الشخص من هاتفه في أي مكان، استخدم رابط التطبيق المنشور عبر الإنترنت وليس <span dir="ltr">localhost</span>.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
