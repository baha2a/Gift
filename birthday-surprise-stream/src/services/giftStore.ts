import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  isFirestoreQuotaExhaustedFlag,
  isQuotaExceededError,
  markFirestoreQuotaExhausted,
} from '../firebase';
import type { GiftRecord } from '../types/gift';

const OWNER_EMAIL = 'ba.aldeen@gmail.com';
const CHUNK_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB (well below nginx/Cloud Run 32 MB limit)

function timestampToIso(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string' && val.length > 0) return val;
  return new Date().toISOString();
}

function mapFirestoreGiftDoc(id: string, data: Record<string, unknown>): GiftRecord | null {
  const sourceType = data.sourceType === 'server' ? 'server' : 'url';
  const videoUrl = typeof data.videoUrl === 'string' ? data.videoUrl.trim() : '';
  if (!videoUrl) return null;

  return {
    id,
    ownerId: String(data.ownerId ?? ''),
    title: String(data.title ?? 'هذه المفاجأة لك'),
    recipientName: String(data.recipientName ?? ''),
    closingMessage: String(data.closingMessage ?? 'كل عام وأنت بألف خير'),
    senderName: String(data.senderName ?? ''),
    originalName: String(data.originalName ?? 'surprise-video.mp4'),
    mimeType: String(data.mimeType ?? 'video/mp4'),
    size: Number(data.size ?? 0),
    sourceType,
    videoUrl,
    allowDownload: Boolean(data.allowDownload ?? true),
    isPrimary: Boolean(data.isPrimary ?? false),
    status: data.status === 'ready' ? 'ready' : 'uploading',
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

export async function fetchActivePrimaryGift(): Promise<GiftRecord | null> {
  try {
    const res = await fetch('/api/gifts/active');
    if (res.ok) {
      const data = (await res.json()) as { gift: GiftRecord | null };
      if (data.gift && data.gift.videoUrl) {
        return data.gift;
      }
    }
  } catch {
    // Fall through to Firestore check
  }

  if (isFirestoreQuotaExhaustedFlag()) {
    return null;
  }

  try {
    const q = query(
      collection(db, 'gifts'),
      where('status', '==', 'ready'),
      where('isPrimary', '==', true),
      limit(5)
    );
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      const mapped = mapFirestoreGiftDoc(d.id, d.data());
      if (mapped && mapped.sourceType === 'url') {
        return mapped;
      }
    }
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markFirestoreQuotaExhausted();
    }
  }

  return null;
}

export async function fetchGiftById(giftId: string): Promise<GiftRecord | null> {
  const cleanId = giftId.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(cleanId)) return null;

  try {
    const res = await fetch(`/api/gifts/active?id=${encodeURIComponent(cleanId)}`);
    if (res.ok) {
      const data = (await res.json()) as { gift: GiftRecord | null };
      if (data.gift && data.gift.videoUrl) {
        return data.gift;
      }
    }
  } catch {
    // Fall through to Firestore check
  }

  if (isFirestoreQuotaExhaustedFlag()) {
    return null;
  }

  try {
    const snap = await getDoc(doc(db, 'gifts', cleanId));
    if (!snap.exists()) return null;
    const gift = mapFirestoreGiftDoc(snap.id, snap.data());
    if (!gift) return null;
    if (gift.status !== 'ready' && auth.currentUser?.uid !== gift.ownerId) {
      return null;
    }
    return gift.sourceType === 'url' ? gift : null;
  } catch (error) {
    if (isQuotaExceededError(error)) {
      markFirestoreQuotaExhausted();
    }
    return null;
  }
}

export async function fetchCreatorGifts(
  userEmail: string | null,
  uid: string
): Promise<{ gifts: GiftRecord[]; quotaExceeded: boolean }> {
  const byId = new Map<string, GiftRecord>();

  try {
    const res = await fetch('/api/gifts');
    if (res.ok) {
      const data = (await res.json()) as { gifts?: GiftRecord[] };
      for (const g of data.gifts ?? []) {
        byId.set(g.id, g);
      }
    }
  } catch {
    // Keep going with Firestore merge if available
  }

  if (!isFirestoreQuotaExhaustedFlag()) {
    try {
      const isBootstrapped = userEmail === OWNER_EMAIL;
      const q = isBootstrapped
        ? query(collection(db, 'gifts'))
        : query(collection(db, 'gifts'), where('ownerId', '==', uid));
      const snap = await getDocs(q);
      for (const d of snap.docs) {
        const mapped = mapFirestoreGiftDoc(d.id, d.data());
        if (mapped && mapped.sourceType === 'url' && !byId.has(mapped.id)) {
          byId.set(mapped.id, mapped);
        }
      }
    } catch (error) {
      if (isQuotaExceededError(error)) {
        markFirestoreQuotaExhausted();
      }
    }
  }

  const gifts = Array.from(byId.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return {
    gifts,
    quotaExceeded: isFirestoreQuotaExhaustedFlag(),
  };
}

function sendChunkWithXhr(
  uploadId: string,
  offset: number,
  chunkBlob: Blob,
  signal: AbortSignal | undefined,
  onChunkProgress: (loadedBytes: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/uploads/${uploadId}/chunk?offset=${offset}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.timeout = 45_000;

    const onAbort = () => {
      xhr.abort();
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        onChunkProgress(Math.min(chunkBlob.size, evt.loaded));
      }
    };

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onChunkProgress(chunkBlob.size);
        resolve();
      } else {
        let message = `فشل رفع الجزء (HTTP ${xhr.status}).`;
        try {
          const parsed = JSON.parse(xhr.responseText) as { error?: string };
          if (parsed.error) message = parsed.error;
        } catch {
          // ignore parse error
        }
        reject(new Error(message));
      }
    };

    xhr.onerror = () => {
      cleanup();
      reject(new Error('تعذر الاتصال بالخادم أثناء رفع الفيديو.'));
    };

    xhr.ontimeout = () => {
      cleanup();
      reject(new Error('انتهت مهلة إرسال جزء من الفيديو.'));
    };

    xhr.send(chunkBlob);
  });
}

export interface UploadGiftFileInput {
  file: File;
  title: string;
  recipientName: string;
  closingMessage: string;
  senderName: string;
  allowDownload: boolean;
  setPrimary: boolean;
  signal?: AbortSignal;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}

export async function uploadGiftFileToServer(input: UploadGiftFileInput): Promise<GiftRecord> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('يرجى تسجيل الدخول بحسابك أولاً.');
  }

  const { file, signal, onProgress } = input;
  const initRes = await fetch('/api/uploads/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      ownerId: user.uid,
      originalName: file.name || 'surprise-video.mp4',
      mimeType: file.type || 'video/mp4',
      size: file.size,
      title: input.title,
      recipientName: input.recipientName,
      closingMessage: input.closingMessage,
      senderName: input.senderName,
      allowDownload: input.allowDownload,
      setPrimary: input.setPrimary,
    }),
  });

  if (!initRes.ok) {
    const errBody = (await initRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || 'تعذر بدء جلسة رفع الفيديو.');
  }

  const { uploadId, chunkSize: serverChunkSize } = (await initRes.json()) as {
    uploadId: string;
    chunkSize?: number;
  };
  const chunkSize = serverChunkSize || CHUNK_SIZE_BYTES;
  const totalSize = file.size;

  try {
    let offset = 0;
    while (offset < totalSize) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const end = Math.min(offset + chunkSize, totalSize);
      const chunkBlob = file.slice(offset, end);

      let attempt = 0;
      while (attempt < 3) {
        attempt += 1;
        try {
          await sendChunkWithXhr(uploadId, offset, chunkBlob, signal, (chunkLoaded) => {
            onProgress?.(Math.min(offset + chunkLoaded, totalSize), totalSize);
          });
          break;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw err;
          }
          if (attempt >= 3) {
            throw err;
          }
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }

      offset = end;
    }

    const completeRes = await fetch(`/api/uploads/${uploadId}/complete`, {
      method: 'POST',
      signal,
    });
    if (!completeRes.ok) {
      const errBody = (await completeRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(errBody.error || 'تعذر إتمام حفظ الفيديو على الخادم.');
    }

    const { gift } = (await completeRes.json()) as { gift: GiftRecord };
    return gift;
  } catch (err) {
    await fetch(`/api/uploads/${uploadId}`, { method: 'DELETE' }).catch(() => {});
    throw err;
  }
}

export interface CreateUrlGiftInput {
  videoUrl: string;
  title: string;
  recipientName: string;
  closingMessage: string;
  senderName: string;
  allowDownload: boolean;
  setPrimary: boolean;
}

export async function createGiftFromExternalUrl(
  input: CreateUrlGiftInput
): Promise<{ gift: GiftRecord; firestoreSynced: boolean; quotaExceeded: boolean }> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('يرجى تسجيل الدخول بحسابك أولاً.');
  }

  const res = await fetch('/api/gifts/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ownerId: user.uid,
      videoUrl: input.videoUrl.trim(),
      title: input.title,
      recipientName: input.recipientName,
      closingMessage: input.closingMessage,
      senderName: input.senderName,
      allowDownload: input.allowDownload,
      setPrimary: input.setPrimary,
    }),
  });

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || 'تعذر حفظ رابط الفيديو.');
  }

  const { gift } = (await res.json()) as { gift: GiftRecord };
  let firestoreSynced = false;

  // Optionally sync tiny (< 1 KB) external URL metadata to Firestore for persistence across container restarts
  if (!isFirestoreQuotaExhaustedFlag()) {
    try {
      if (gift.isPrimary) {
        const existingSnap = await getDocs(
          query(collection(db, 'gifts'), where('isPrimary', '==', true))
        );
        await Promise.all(
          existingSnap.docs
            .filter((d) => d.id !== gift.id)
            .map((d) =>
              updateDoc(doc(db, 'gifts', d.id), {
                isPrimary: false,
                updatedAt: serverTimestamp(),
              }).catch(() => {})
            )
        );
      }

      await setDoc(doc(db, 'gifts', gift.id), {
        id: gift.id,
        ownerId: user.uid,
        title: gift.title,
        recipientName: gift.recipientName,
        closingMessage: gift.closingMessage,
        senderName: gift.senderName,
        originalName: gift.originalName,
        mimeType: gift.mimeType,
        size: gift.size,
        sourceType: 'url',
        videoUrl: gift.videoUrl.slice(0, 500),
        allowDownload: gift.allowDownload,
        isPrimary: gift.isPrimary,
        status: 'ready',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      firestoreSynced = true;
    } catch (error) {
      if (isQuotaExceededError(error)) {
        markFirestoreQuotaExhausted();
      }
    }
  }

  return {
    gift,
    firestoreSynced,
    quotaExceeded: isFirestoreQuotaExhaustedFlag(),
  };
}

export async function updateGiftMetadata(
  giftId: string,
  fields: {
    title: string;
    recipientName: string;
    closingMessage: string;
    senderName: string;
    allowDownload: boolean;
  }
): Promise<void> {
  const payload = {
    title: (fields.title.trim() || 'هذه المفاجأة لك').slice(0, 100),
    recipientName: fields.recipientName.trim().slice(0, 80),
    closingMessage: (fields.closingMessage.trim() || 'كل عام وأنت بألف خير').slice(0, 140),
    senderName: fields.senderName.trim().slice(0, 80),
    allowDownload: fields.allowDownload,
  };

  await fetch(`/api/gifts/${encodeURIComponent(giftId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});

  if (!isFirestoreQuotaExhaustedFlag()) {
    try {
      const ref = doc(db, 'gifts', giftId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      if (isQuotaExceededError(error)) {
        markFirestoreQuotaExhausted();
      }
    }
  }
}

export async function setGiftAsPrimary(giftId: string, allGifts: GiftRecord[]): Promise<void> {
  await fetch(`/api/gifts/${encodeURIComponent(giftId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isPrimary: true }),
  }).catch(() => {});

  if (!isFirestoreQuotaExhaustedFlag()) {
    try {
      const demotes = allGifts
        .filter((g) => g.id !== giftId && g.isPrimary && g.sourceType === 'url')
        .map((g) =>
          updateDoc(doc(db, 'gifts', g.id), {
            isPrimary: false,
            updatedAt: serverTimestamp(),
          }).catch(() => {})
        );
      await Promise.all(demotes);

      const targetRef = doc(db, 'gifts', giftId);
      const snap = await getDoc(targetRef);
      if (snap.exists()) {
        await updateDoc(targetRef, {
          isPrimary: true,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      if (isQuotaExceededError(error)) {
        markFirestoreQuotaExhausted();
      }
    }
  }
}

export async function deleteGiftPermanently(giftId: string): Promise<void> {
  await fetch(`/api/gifts/${encodeURIComponent(giftId)}`, {
    method: 'DELETE',
  }).catch(() => {});

  if (!isFirestoreQuotaExhaustedFlag()) {
    try {
      await deleteDoc(doc(db, 'gifts', giftId));
    } catch (error) {
      if (isQuotaExceededError(error)) {
        markFirestoreQuotaExhausted();
      }
    }
  }
}
