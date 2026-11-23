import { useCallback, useEffect, useState } from 'react';
import CreatorStudio from './components/CreatorStudio';
import SurpriseStage from './components/SurpriseStage';
import { fetchActivePrimaryGift, fetchGiftById } from './services/giftStore';
import type { GiftRecord } from './types/gift';

type ViewMode = 'loading' | 'surprise' | 'studio' | 'empty-public' | 'not-found';

function getRouteInfo(): { requestedGiftId: string | null; isStudioRoute: boolean } {
  const url = new URL(window.location.href);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const queryGift = url.searchParams.get('gift');
  const queryStudio = url.searchParams.get('studio');

  const isStudioRoute =
    queryStudio === '1' || path === '/studio' || path === '/upload' || path === '/manage';

  let requestedGiftId = queryGift;
  if (!requestedGiftId && path.startsWith('/g/')) {
    const slug = path.slice(3).trim();
    if (slug) requestedGiftId = slug;
  }

  return { requestedGiftId, isStudioRoute };
}

export default function App() {
  const [mode, setMode] = useState<ViewMode>('loading');
  const [activeGift, setActiveGift] = useState<GiftRecord | null>(null);

  const loadRoute = useCallback(async () => {
    const { requestedGiftId, isStudioRoute } = getRouteInfo();

    // Strict separation: /studio is exclusively for uploading/managing videos
    if (isStudioRoute) {
      setMode('studio');
      return;
    }

    setMode('loading');
    try {
      if (requestedGiftId) {
        const gift = await fetchGiftById(requestedGiftId);
        if (!gift) {
          setActiveGift(null);
          setMode('not-found');
          return;
        }
        setActiveGift(gift);
        setMode('surprise');
        return;
      }

      const primary = await fetchActivePrimaryGift();
      if (!primary) {
        setActiveGift(null);
        // Never expose upload/studio UI on the public homepage
        setMode('empty-public');
        return;
      }

      setActiveGift(primary);
      setMode('surprise');
    } catch {
      setMode('not-found');
    }
  }, []);

  useEffect(() => {
    loadRoute();
    const handlePopState = () => {
      loadRoute();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [loadRoute]);

  const handlePreviewGift = (gift: GiftRecord) => {
    setActiveGift(gift);
    const targetUrl = gift.isPrimary ? '/' : `/g/${gift.id}`;
    window.history.pushState({}, '', targetUrl);
    setMode('surprise');
  };

  if (mode === 'loading') {
    return (
      <div className="min-h-screen bg-[#060608] text-[#F6F1E7] flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-[#E5B869]/25 border-t-[#E5B869] animate-spin" />
      </div>
    );
  }

  if (mode === 'studio') {
    return <CreatorStudio onPreviewGift={handlePreviewGift} />;
  }

  if (mode === 'empty-public') {
    return (
      <div className="min-h-screen bg-[#060608] text-[#F6F1E7] flex flex-col items-center justify-center px-6 text-center">
        <p className="text-sm text-[#E5B869] mb-4">ياذات الثغر الجميل</p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold mb-3">
          مفاجأة قيد التجهيز
        </h1>
        <p className="text-sm text-[#A69D8E] max-w-md">
          لم يتم نشر العرض بعد، يرجى العودة لاحقاً.
        </p>
      </div>
    );
  }

  if (mode === 'not-found' || !activeGift) {
    return (
      <div className="min-h-screen bg-[#060608] text-[#F6F1E7] flex flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-3xl sm:text-4xl font-bold mb-3">
          لم يتم العثور على هذا العرض
        </h1>
        <p className="text-sm text-[#A69D8E] mb-8 max-w-md">
          قد يكون الرابط غير مكتمل أو تم حذف الفيديو من قِبل صاحبه.
        </p>
      </div>
    );
  }

  return <SurpriseStage gift={activeGift} />;
}
