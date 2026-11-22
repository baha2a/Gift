import { useCallback, useEffect, useState } from 'react';
import CreatorStudio from './components/CreatorStudio';
import SurpriseStage from './components/SurpriseStage';
import type { GiftRecord } from './types/gift';

type ViewMode = 'loading' | 'surprise' | 'studio' | 'not-found';

function getInitialRouteState(): { requestedGiftId: string | null; wantsStudio: boolean } {
  const url = new URL(window.location.href);
  const path = url.pathname;
  const queryGift = url.searchParams.get('gift');
  const queryStudio = url.searchParams.get('studio');

  const wantsStudio = queryStudio === '1' || path === '/studio';
  let requestedGiftId = queryGift;

  if (!requestedGiftId && path.startsWith('/g/')) {
    const slug = path.slice(3).replace(/\/+$/, '').trim();
    if (slug) requestedGiftId = slug;
  }

  return { requestedGiftId, wantsStudio };
}

export default function App() {
  const [mode, setMode] = useState<ViewMode>('loading');
  const [gifts, setGifts] = useState<GiftRecord[]>([]);
  const [activeGift, setActiveGift] = useState<GiftRecord | null>(null);

  const loadState = useCallback(async (preferredGiftId?: string) => {
    try {
      const { requestedGiftId, wantsStudio } = getInitialRouteState();
      const targetId = preferredGiftId ?? requestedGiftId;

      const listRes = await fetch('/api/gifts');
      const listData = (await listRes.json()) as {
        gifts: GiftRecord[];
        primaryGift: GiftRecord | null;
      };
      const allGifts = Array.isArray(listData.gifts) ? listData.gifts : [];
      setGifts(allGifts);

      if (allGifts.length === 0) {
        setActiveGift(null);
        setMode('studio');
        return;
      }

      let chosen: GiftRecord | null = null;
      if (targetId) {
        chosen = allGifts.find((g) => g.id === targetId) ?? null;
        if (!chosen && requestedGiftId && !wantsStudio) {
          setActiveGift(null);
          setMode('not-found');
          return;
        }
      }

      if (!chosen) {
        chosen = listData.primaryGift ?? allGifts[0] ?? null;
      }

      setActiveGift(chosen);
      setMode(wantsStudio ? 'studio' : 'surprise');
    } catch {
      setMode('studio');
    }
  }, []);

  useEffect(() => {
    loadState();
    const handlePopState = () => {
      loadState();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [loadState]);

  const handlePreviewGift = (gift: GiftRecord) => {
    setActiveGift(gift);
    const url = new URL(window.location.href);
    url.searchParams.delete('studio');
    if (gift.isPrimary) {
      url.searchParams.delete('gift');
      if (url.pathname === '/studio' || url.pathname.startsWith('/g/')) {
        url.pathname = '/';
      }
    } else {
      url.searchParams.set('gift', gift.id);
    }
    window.history.pushState({}, '', url.toString());
    setMode('surprise');
  };

  if (mode === 'loading') {
    return (
      <div className="min-h-screen bg-[#060608] text-[#F6F1E7] flex items-center justify-center">
        <div className="w-10 h-10 rounded-full border-2 border-[#E5B869]/25 border-t-[#E5B869] animate-spin" />
      </div>
    );
  }

  if (mode === 'not-found') {
    return (
      <div className="min-h-screen bg-[#060608] text-[#F6F1E7] flex flex-col items-center justify-center px-6 text-center">
        <h1 className="font-display text-3xl sm:text-4xl font-bold mb-3">
          لم يتم العثور على هذا الإهداء
        </h1>
        <p className="text-sm text-[#A69D8E] mb-8 max-w-md">
          قد يكون الرابط غير مكتمل أو تم حذف الفيديو من المكتبة.
        </p>
        <button
          type="button"
          onClick={() => {
            window.history.pushState({}, '', '/');
            loadState();
          }}
          className="px-6 py-3 rounded-full bg-[#E5B869] text-[#09080A] text-sm font-semibold hover:bg-[#EFC77E] transition-colors cursor-pointer"
        >
          الانتقال للعرض الرئيسي
        </button>
      </div>
    );
  }

  if (mode === 'studio' || !activeGift) {
    return (
      <CreatorStudio
        gifts={gifts}
        activeGift={activeGift}
        onGiftsChanged={async (preferredId) => {
          await loadState(preferredId);
          setMode('studio');
        }}
        onPreviewGift={handlePreviewGift}
      />
    );
  }

  return <SurpriseStage gift={activeGift} />;
}
