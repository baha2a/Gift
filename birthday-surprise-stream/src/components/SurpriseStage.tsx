import confetti from 'canvas-confetti';
import {
  Download,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GiftRecord } from '../types/gift';

const VELVET_COVER_IMAGE = '/src/assets/images/gift_velvet_cover_1795357535095.jpg';
const SANCTUARY_STAGE_IMAGE = '/src/assets/images/cinema_sanctuary_stage_1795359069285.jpg';
const BOKEH_FINALE_IMAGE = '/src/assets/images/cinema_golden_bokeh_1795357534815.jpg';

type Stage = 'cover' | 'playing' | 'finale';

interface SurpriseStageProps {
  gift: GiftRecord;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hrs > 0) return `${hrs}:${pad(mins)}:${pad(secs)}`;
  return `${pad(mins)}:${pad(secs)}`;
}

// Minimalist floating golden ember coordinates around the theatre stage
const STAGE_EMBERS = [
  { top: '14%', left: '8%', size: 4, delay: 0, duration: 5.5 },
  { top: '26%', left: '91%', size: 3, delay: 1.1, duration: 6.2 },
  { top: '68%', left: '6%', size: 5, delay: 0.7, duration: 5.8 },
  { top: '76%', left: '93%', size: 4, delay: 1.8, duration: 6.5 },
  { top: '18%', left: '22%', size: 3, delay: 2.1, duration: 7.0 },
  { top: '82%', left: '24%', size: 3, delay: 0.4, duration: 6.0 },
  { top: '20%', left: '78%', size: 4, delay: 1.4, duration: 5.6 },
  { top: '84%', left: '76%', size: 3, delay: 2.5, duration: 6.8 },
];

export default function SurpriseStage({ gift }: SurpriseStageProps) {
  const prefersReducedMotion = useReducedMotion();
  const [stage, setStage] = useState<Stage>('cover');
  const [coverImageFailed, setCoverImageFailed] = useState(false);
  const [sanctuaryImageFailed, setSanctuaryImageFailed] = useState(false);
  const [finaleImageFailed, setFinaleImageFailed] = useState(false);

  // Download state for large Range-chunked files
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // Video player state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerWrapperRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimer = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [videoError, setVideoError] = useState(false);

  // Never spoil "birthday" on the initial cover screen
  const displayCoverTitle =
    gift.title === 'هدية عيد ميلاد خاصة' || gift.title === 'مفاجأة خاصة لك'
      ? 'هذه المفاجأة لك'
      : gift.title;

  const fireGoldenCelebration = useCallback(
    (intensity: 'unveil' | 'finale') => {
      if (prefersReducedMotion) return;
      const colors = ['#E5B869', '#F6E2B3', '#C9963B', '#FFF8E7'];

      if (intensity === 'unveil') {
        confetti({
          particleCount: 60,
          spread: 80,
          origin: { y: 0.56 },
          colors,
          scalar: 0.9,
          ticks: 190,
          disableForReducedMotion: true,
        });
      } else {
        confetti({
          particleCount: 45,
          angle: 60,
          spread: 55,
          origin: { x: 0.12, y: 0.72 },
          colors,
          scalar: 0.85,
          ticks: 220,
          disableForReducedMotion: true,
        });
        confetti({
          particleCount: 45,
          angle: 120,
          spread: 55,
          origin: { x: 0.88, y: 0.72 },
          colors,
          scalar: 0.85,
          ticks: 220,
          disableForReducedMotion: true,
        });
      }
    },
    [prefersReducedMotion]
  );

  const scheduleControlsHide = useCallback(() => {
    if (hideControlsTimer.current) {
      window.clearTimeout(hideControlsTimer.current);
    }
    setShowControls(true);
    hideControlsTimer.current = window.setTimeout(() => {
      setShowControls(false);
    }, 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (hideControlsTimer.current) {
        window.clearTimeout(hideControlsTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const startPlayback = useCallback(() => {
    const vid = videoRef.current;
    if (!vid || !gift.videoUrl) return;
    vid.currentTime = 0;
    vid.muted = false;
    setIsMuted(false);
    const playPromise = vid.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          setIsPlaying(true);
          scheduleControlsHide();
        })
        .catch(() => {
          setIsPlaying(false);
          setShowControls(true);
        });
    }
  }, [scheduleControlsHide, gift.videoUrl]);

  const handleOpenSurprise = () => {
    fireGoldenCelebration('unveil');
    setVideoError(false);
    setStage('playing');
  };

  useEffect(() => {
    if (stage === 'playing' && gift.videoUrl) {
      const timer = window.setTimeout(() => {
        startPlayback();
      }, 220);
      return () => window.clearTimeout(timer);
    }
  }, [stage, gift.videoUrl, startPlayback]);

  const togglePlayPause = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.play().then(() => {
        setIsPlaying(true);
        scheduleControlsHide();
      });
    } else {
      vid.pause();
      setIsPlaying(false);
      setShowControls(true);
    }
  };

  const handleSeek = (nextTime: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = nextTime;
    setCurrentTime(nextTime);
    scheduleControlsHide();
  };

  const handleVolumeChange = (nextVol: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.volume = nextVol;
    vid.muted = nextVol === 0;
    setVolume(nextVol);
    setIsMuted(nextVol === 0);
  };

  const toggleMute = () => {
    const vid = videoRef.current;
    if (!vid) return;
    const nextMuted = !isMuted;
    vid.muted = nextMuted;
    setIsMuted(nextMuted);
    if (!nextMuted && volume === 0) {
      vid.volume = 0.8;
      setVolume(0.8);
    }
  };

  const toggleFullscreen = async () => {
    const wrapper = playerWrapperRef.current;
    if (!wrapper) return;
    try {
      if (!document.fullscreenElement) {
        await wrapper.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      const vid = videoRef.current as
        | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
        | null;
      if (vid?.webkitEnterFullscreen) {
        vid.webkitEnterFullscreen();
      }
    }
  };

  const handleVideoEnded = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    setIsPlaying(false);
    setStage('finale');
    window.setTimeout(() => {
      fireGoldenCelebration('finale');
    }, 280);
  };

  const handleReplay = () => {
    setVideoError(false);
    setStage('playing');
    window.setTimeout(() => {
      startPlayback();
    }, 180);
  };

  const handleRetryVideo = () => {
    setVideoError(false);
    setIsBuffering(true);
    const vid = videoRef.current;
    if (vid) {
      vid.load();
    }
    window.setTimeout(() => {
      startPlayback();
    }, 180);
  };

  const handleDownloadFullVideo = async () => {
    if (!gift.videoUrl || isDownloading) return;
    const filename = gift.originalName || `special-surprise-${gift.id}.mp4`;

    // For large server-hosted videos (>16MB), fetch 4MB Range slices to bypass the 32MB response cap
    if (gift.sourceType === 'server' && gift.size > 16 * 1024 * 1024) {
      setIsDownloading(true);
      setDownloadProgress(0);
      try {
        const CHUNK = 4 * 1024 * 1024;
        const parts: BlobPart[] = [];
        let start = 0;
        while (start < gift.size) {
          const end = Math.min(start + CHUNK - 1, gift.size - 1);
          const res = await fetch(gift.videoUrl, {
            headers: { Range: `bytes=${start}-${end}` },
          });
          if (!res.ok && res.status !== 206) {
            throw new Error(`HTTP ${res.status}`);
          }
          const buf = await res.arrayBuffer();
          parts.push(buf);
          start = end + 1;
          setDownloadProgress(Math.min(100, Math.round((start / gift.size) * 100)));
        }

        const blob = new Blob(parts, { type: gift.mimeType || 'video/mp4' });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      } catch {
        // Fallback to direct download URL if Range assembly fails
        const a = document.createElement('a');
        a.href = `${gift.videoUrl}?download=1`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } finally {
        setIsDownloading(false);
        setDownloadProgress(0);
      }
      return;
    }

    const downloadHref =
      gift.sourceType === 'server'
        ? `${gift.videoUrl}${gift.videoUrl.includes('?') ? '&' : '?'}download=1`
        : gift.videoUrl;
    const a = document.createElement('a');
    a.href = downloadHref;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="relative min-h-screen w-full bg-[#060608] text-[#F6F1E7] overflow-hidden flex flex-col">
      <AnimatePresence mode="wait">
        {stage === 'cover' && (
          <motion.section
            key="stage-cover"
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 1.04 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex-1 flex flex-col items-center justify-center min-h-screen px-6 py-12"
          >
            {/* Atmospheric Velvet Cover Background */}
            <div className="absolute inset-0 z-0">
              {!coverImageFailed ? (
                <img
                  src={VELVET_COVER_IMAGE}
                  alt="غلاف مخملي داكن بختم ذهبي"
                  referrerPolicy="no-referrer"
                  onError={() => setCoverImageFailed(true)}
                  className="w-full h-full object-cover object-center opacity-55 scale-105"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#141118] via-[#060608] to-[#1A140B]" />
              )}
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-[#060608] via-[#060608]/65 to-[#060608]/85"
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(229,184,105,0.12)_0%,transparent_62%)]"
              />
            </div>

            {/* Centerpiece Pure Surprise Invitation (Zero Studio/Admin UI) */}
            <div className="relative z-10 max-w-2xl w-full text-center flex flex-col items-center">
              <p className="text-sm md:text-base text-[#E5B869] tracking-wide mb-6 leading-relaxed">
                ياذات الثغر الجميل
              </p>

              {gift.recipientName && (
                <p className="text-lg md:text-xl text-[#D8CEBE] mb-3 font-normal">
                  {gift.recipientName}
                </p>
              )}

              <h1
                className="font-display text-4xl sm:text-5xl md:text-6xl font-bold text-[#F6F1E7] leading-[1.25] mb-10"
                style={{ textWrap: 'balance' }}
              >
                {displayCoverTitle}
              </h1>

              {/* Primary Tactile Surprise Trigger */}
              <button
                type="button"
                onClick={handleOpenSurprise}
                className="group relative inline-flex items-center justify-center gap-4 px-9 py-4.5 rounded-full bg-[#E5B869] text-[#09080A] font-semibold text-base md:text-lg shadow-[0_12px_40px_rgba(229,184,105,0.3)] hover:bg-[#EFC77E] hover:shadow-[0_16px_52px_rgba(229,184,105,0.45)] active:scale-[0.98] transition-all duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#E5B869] whitespace-nowrap shrink-0"
              >
                <span className="flex items-center justify-center w-9 h-9 rounded-full bg-[#09080A]/12 group-hover:bg-[#09080A]/18 transition-colors">
                  <Sparkles className="w-5 h-5" />
                </span>
                <span>افتحي المفاجأة</span>
              </button>

              <p className="mt-7 text-xs md:text-sm text-[#A69D8E]">
                اضغطي لبدء العرض
              </p>
            </div>
          </motion.section>
        )}

        {stage === 'playing' && (
          <motion.section
            key="stage-playing"
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex-1 flex flex-col items-center justify-center min-h-screen px-4 py-6 sm:px-10 sm:py-10 overflow-hidden"
          >
            {/* Enchanting Candlelit Velvet Sanctuary Backdrop */}
            <div className="absolute inset-0 z-0">
              {!sanctuaryImageFailed ? (
                <img
                  src={SANCTUARY_STAGE_IMAGE}
                  alt="مسرح مخملي دافئ بإضاءة الشموع"
                  referrerPolicy="no-referrer"
                  onError={() => setSanctuaryImageFailed(true)}
                  className="w-full h-full object-cover object-center opacity-70 scale-105"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-b from-[#161009] via-[#09080B] to-[#060608]" />
              )}

              <div
                aria-hidden="true"
                className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(229,184,105,0.14)_0%,rgba(10,8,9,0.58)_55%,rgba(5,5,7,0.92)_100%)]"
              />
            </div>

            {/* Delicate Floating Golden Embers */}
            {!prefersReducedMotion && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-[1] overflow-hidden"
              >
                {STAGE_EMBERS.map((ember, idx) => (
                  <motion.span
                    key={idx}
                    className="absolute rounded-full bg-[#F6E2B3]"
                    style={{
                      top: ember.top,
                      left: ember.left,
                      width: ember.size,
                      height: ember.size,
                      boxShadow: '0 0 12px rgba(229,184,105,0.85)',
                    }}
                    animate={{
                      y: [0, -18, 0],
                      opacity: [0.22, 0.78, 0.22],
                      scale: [0.9, 1.25, 0.9],
                    }}
                    transition={{
                      duration: ember.duration,
                      delay: ember.delay,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                  />
                ))}
              </div>
            )}

            {/* Brief Parting Stage Curtains Reveal */}
            {!prefersReducedMotion && (
              <>
                <motion.div
                  aria-hidden="true"
                  initial={{ x: '0%', opacity: 0.96 }}
                  animate={{ x: '-105%', opacity: 0 }}
                  transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
                  className="pointer-events-none fixed inset-y-0 left-0 w-1/2 z-30 bg-gradient-to-r from-[#09070A] via-[#130E0B] to-[#1D150D] border-r border-[#E5B869]/25"
                />
                <motion.div
                  aria-hidden="true"
                  initial={{ x: '0%', opacity: 0.96 }}
                  animate={{ x: '105%', opacity: 0 }}
                  transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
                  className="pointer-events-none fixed inset-y-0 right-0 w-1/2 z-30 bg-gradient-to-l from-[#09070A] via-[#130E0B] to-[#1D150D] border-l border-[#E5B869]/25"
                />
              </>
            )}

            {/* Video Emerging From Warm Illuminated Gilded Keepsake Frame */}
            <motion.div
              initial={
                prefersReducedMotion
                  ? { opacity: 1 }
                  : { opacity: 0, scale: 0.86, filter: 'blur(10px)' }
              }
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ duration: 0.9, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 w-full max-w-5xl flex flex-col items-center"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -inset-8 rounded-[36px] bg-[radial-gradient(ellipse_at_center,rgba(229,184,105,0.22)_0%,transparent_72%)] blur-2xl"
              />

              {/* Double-Bezel Gilded Frame */}
              <div className="relative w-full p-[3px] rounded-[22px] bg-gradient-to-b from-[#E5B869]/60 via-[#E5B869]/22 to-[#E5B869]/50 shadow-[0_30px_100px_rgba(0,0,0,0.88),0_0_80px_rgba(229,184,105,0.18)]">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-2 -right-2 w-6 h-6 border-t-2 border-r-2 border-[#E5B869]/80 rounded-tr-xl"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-2 -left-2 w-6 h-6 border-t-2 border-l-2 border-[#E5B869]/80 rounded-tl-xl"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -bottom-2 -right-2 w-6 h-6 border-b-2 border-r-2 border-[#E5B869]/80 rounded-br-xl"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -bottom-2 -left-2 w-6 h-6 border-b-2 border-l-2 border-[#E5B869]/80 rounded-bl-xl"
                />

                <div
                  ref={playerWrapperRef}
                  onMouseMove={scheduleControlsHide}
                  onTouchStart={scheduleControlsHide}
                  className="relative w-full rounded-[19px] overflow-hidden bg-[#060608] flex items-center justify-center"
                  style={{ aspectRatio: '16 / 9', maxHeight: '82vh' }}
                >
                  <video
                    ref={videoRef}
                    src={gift.videoUrl}
                    playsInline
                    preload="auto"
                    onClick={togglePlayPause}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => {
                      setIsPlaying(false);
                      setShowControls(true);
                    }}
                    onWaiting={() => setIsBuffering(true)}
                    onCanPlay={() => setIsBuffering(false)}
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                    onEnded={handleVideoEnded}
                    onError={() => {
                      setVideoError(true);
                      setIsBuffering(false);
                    }}
                    className="w-full h-full object-contain bg-black cursor-pointer"
                  />

                  {/* Top Overlay Bar (auto-hides during playback) */}
                  <div
                    className={`absolute inset-x-0 top-0 p-4 sm:p-5 bg-gradient-to-b from-black/80 via-black/35 to-transparent flex items-center justify-between transition-opacity duration-200 ${
                      showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs sm:text-sm text-[#F6F1E7]/90 truncate">
                      <span className="font-medium truncate">{displayCoverTitle}</span>
                      <span className="text-[#E5B869]" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-[#A69D8E] whitespace-nowrap">الجودة الأصلية</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        videoRef.current?.pause();
                        setStage('cover');
                      }}
                      className="text-xs text-[#D8CEBE] hover:text-[#F6F1E7] px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      العودة للغلاف
                    </button>
                  </div>

                  {/* Loading / Error / Play Center States */}
                  {videoError ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 p-6 text-center">
                      <p className="text-base text-[#F6F1E7] mb-4">
                        تعذر تشغيل الفيديو حالياً.
                      </p>
                      <button
                        type="button"
                        onClick={handleRetryVideo}
                        className="px-5 py-2.5 rounded-lg bg-[#E5B869] text-[#09080A] text-sm font-semibold hover:bg-[#EFC77E] transition-colors cursor-pointer"
                      >
                        إعادة المحاولة
                      </button>
                    </div>
                  ) : isBuffering ? (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full border-2 border-[#E5B869]/30 border-t-[#E5B869] animate-spin" />
                    </div>
                  ) : !isPlaying ? (
                    <button
                      type="button"
                      onClick={togglePlayPause}
                      aria-label="تشغيل الفيديو"
                      className="absolute inset-0 m-auto w-20 h-20 rounded-full bg-[#E5B869]/95 text-[#09080A] flex items-center justify-center shadow-[0_0_40px_rgba(229,184,105,0.45)] hover:scale-105 transition-transform duration-200 cursor-pointer"
                    >
                      <Play className="w-8 h-8 fill-current me-[-2px]" />
                    </button>
                  ) : null}

                  {/* Bottom Custom Cinema Control Bar */}
                  {!videoError && (
                    <div
                      dir="ltr"
                      className={`absolute inset-x-0 bottom-0 p-3 sm:p-5 bg-gradient-to-t from-black/90 via-black/55 to-transparent transition-opacity duration-200 ${
                        showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
                      }`}
                    >
                      <div className="relative flex items-center mb-3">
                        <div className="w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#E5B869] rounded-full"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={duration || 0}
                          step={0.1}
                          value={currentTime}
                          onChange={(e) => handleSeek(Number(e.target.value))}
                          aria-label="التحكم في موضع الفيديو"
                          className="cinema-range absolute inset-0 w-full h-4 opacity-0 hover:opacity-100 focus:opacity-100"
                        />
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 sm:gap-4">
                          <button
                            type="button"
                            onClick={togglePlayPause}
                            aria-label={isPlaying ? 'إيقاف مؤقت' : 'تشغيل'}
                            className="w-10 h-10 rounded-lg flex items-center justify-center text-[#F6F1E7] hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                          </button>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={toggleMute}
                              aria-label={isMuted ? 'إلغاء كتم الصوت' : 'كتم الصوت'}
                              className="w-10 h-10 rounded-lg flex items-center justify-center text-[#F6F1E7] hover:bg-white/10 transition-colors cursor-pointer"
                            >
                              {isMuted || volume === 0 ? (
                                <VolumeX className="w-5 h-5 text-[#A69D8E]" />
                              ) : (
                                <Volume2 className="w-5 h-5" />
                              )}
                            </button>
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={isMuted ? 0 : volume}
                              onChange={(e) => handleVolumeChange(Number(e.target.value))}
                              aria-label="مستوى الصوت"
                              className="cinema-range hidden sm:block w-20 h-1 bg-white/25 rounded-full accent-[#E5B869]"
                            />
                          </div>

                          <span className="text-xs sm:text-sm text-[#D8CEBE] tabular-nums select-none">
                            {formatTime(currentTime)} / {formatTime(duration)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={toggleFullscreen}
                            aria-label={isFullscreen ? 'تصغير الشاشة' : 'ملء الشاشة'}
                            className="w-10 h-10 rounded-lg flex items-center justify-center text-[#F6F1E7] hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            {isFullscreen ? (
                              <Minimize2 className="w-5 h-5" />
                            ) : (
                              <Maximize2 className="w-5 h-5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div
                aria-hidden="true"
                className="w-4/5 h-6 mt-3 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(229,184,105,0.22)_0%,transparent_70%)] blur-md"
              />
            </motion.div>
          </motion.section>
        )}

        {stage === 'finale' && (
          <motion.section
            key="stage-finale"
            initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="relative flex-1 flex flex-col items-center justify-center min-h-screen px-6 py-12"
          >
            {/* Theatrical Golden Bokeh Curtain Backdrop */}
            <div className="absolute inset-0 z-0">
              {!finaleImageFailed ? (
                <img
                  src={BOKEH_FINALE_IMAGE}
                  alt="ستائر ختامية مع أضواء ذهبية دافئة"
                  referrerPolicy="no-referrer"
                  onError={() => setFinaleImageFailed(true)}
                  className="w-full h-full object-cover object-center opacity-55"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-b from-[#09080A] via-[#13100A] to-[#060608]" />
              )}
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-[#060608] via-[#060608]/60 to-[#060608]/85"
              />
            </div>

            <motion.div
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="relative z-10 max-w-2xl w-full text-center flex flex-col items-center"
            >
              <div className="w-12 h-12 rounded-full border border-[#E5B869]/35 bg-[#E5B869]/10 flex items-center justify-center text-[#E5B869] mb-7">
                <Sparkles className="w-5 h-5" />
              </div>

              <h2
                className="font-display text-4xl sm:text-5xl md:text-6xl font-bold text-[#F6F1E7] leading-[1.3] mb-5"
                style={{ textWrap: 'balance' }}
              >
                {gift.closingMessage}
              </h2>

              {gift.senderName && (
                <p className="text-base md:text-lg text-[#E5B869] mb-10">
                  مع خالص المودة — {gift.senderName}
                </p>
              )}

              {!gift.senderName && <div className="mb-8" />}

              <div className="flex flex-wrap items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={handleReplay}
                  className="inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-full bg-[#E5B869] text-[#09080A] font-semibold text-sm md:text-base hover:bg-[#EFC77E] active:scale-[0.98] transition-all duration-200 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>إعادة المشاهدة</span>
                </button>

                {gift.allowDownload && gift.videoUrl && (
                  <button
                    type="button"
                    disabled={isDownloading}
                    onClick={handleDownloadFullVideo}
                    className="inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-full border border-[#E5B869]/35 bg-[#121115]/80 text-[#F6F1E7] font-medium text-sm md:text-base hover:bg-[#1B191F] hover:border-[#E5B869]/60 disabled:opacity-60 transition-all duration-200 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-4 h-4 text-[#E5B869]" />
                    <span>
                      {isDownloading
                        ? `جاري التحميل (${downloadProgress}%)`
                        : 'حفظ الفيديو بالجودة الكاملة'}
                    </span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setStage('cover')}
                className="mt-8 text-xs sm:text-sm text-[#A69D8E] hover:text-[#F6F1E7] transition-colors py-2 px-3 cursor-pointer"
              >
                العودة إلى الغلاف
              </button>
            </motion.div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
