import crypto from 'crypto';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';

dotenv.config();

interface GiftRecord {
  id: string;
  title: string;
  recipientName: string;
  closingMessage: string;
  senderName: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  allowDownload: boolean;
  isPrimary: boolean;
  createdAt: string;
}

interface UploadSession {
  uploadId: string;
  tempFilename: string;
  finalExt: string;
  originalName: string;
  mimeType: string;
  expectedSize: number;
  bytesReceived: number;
  title: string;
  recipientName: string;
  closingMessage: string;
  senderName: string;
  allowDownload: boolean;
  setPrimary: boolean;
  createdAt: string;
}

const PORT = Number(process.env.PORT) || 3000;
const CHUNK_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB chunks — safely under Cloud Run / nginx 32 MB cap
const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
const VIDEOS_DIR = path.join(STORAGE_ROOT, 'videos');
const TMP_DIR = path.join(STORAGE_ROOT, 'tmp');
const GIFTS_DB_PATH = path.join(STORAGE_ROOT, 'gifts.json');

fs.mkdirSync(VIDEOS_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(GIFTS_DB_PATH)) {
  fs.writeFileSync(GIFTS_DB_PATH, JSON.stringify([], null, 2), 'utf-8');
}

// Clean stale incomplete temp uploads older than 24 hours on startup
try {
  const now = Date.now();
  for (const entry of fs.readdirSync(TMP_DIR)) {
    const fullPath = path.join(TMP_DIR, entry);
    const stat = fs.statSync(fullPath);
    if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) {
      fs.unlinkSync(fullPath);
    }
  }
} catch {
  // Ignore cleanup errors
}

function readGifts(): GiftRecord[] {
  try {
    const raw = fs.readFileSync(GIFTS_DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item: GiftRecord) => {
      if (!item || typeof item.filename !== 'string') return false;
      return fs.existsSync(path.join(VIDEOS_DIR, path.basename(item.filename)));
    });
  } catch {
    return [];
  }
}

function writeGifts(gifts: GiftRecord[]): void {
  const tempPath = `${GIFTS_DB_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(gifts, null, 2), 'utf-8');
  fs.renameSync(tempPath, GIFTS_DB_PATH);
}

const ALLOWED_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.ogg', '.mkv']);

function inferMimeType(filePath: string, fallbackMime: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.ogg') return 'video/ogg';
  if (ext === '.mkv') return 'video/x-matroska';
  return fallbackMime || 'video/mp4';
}

function sanitizeText(value: unknown, fallback: string, maxLen = 120): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, maxLen) : fallback;
}

function isValidUploadId(id: string): boolean {
  return /^[a-f0-9]{16}$/.test(id);
}

function getSessionMetaPath(uploadId: string): string {
  return path.join(TMP_DIR, `${uploadId}.json`);
}

function getSessionPartPath(uploadId: string): string {
  return path.join(TMP_DIR, `${uploadId}.part`);
}

function readSession(uploadId: string): UploadSession | null {
  if (!isValidUploadId(uploadId)) return null;
  const metaPath = getSessionMetaPath(uploadId);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as UploadSession;
  } catch {
    return null;
  }
}

function writeSession(session: UploadSession): void {
  const metaPath = getSessionMetaPath(session.uploadId);
  fs.writeFileSync(metaPath, JSON.stringify(session, null, 2), 'utf-8');
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, VIDEOS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.mp4';
    const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isVideoMime = file.mimetype.startsWith('video/');
    if (isVideoMime || ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('يرجى اختيار ملف فيديو صالح (MP4 أو MOV أو WebM).'));
    }
  },
});

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // List all permanently stored gifts
  app.get('/api/gifts', (_req: Request, res: Response) => {
    const gifts = readGifts();
    const sorted = [...gifts].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const primaryGift = sorted.find((g) => g.isPrimary) ?? sorted[0] ?? null;
    res.json({ gifts: sorted, primaryGift });
  });

  // Fetch the active primary gift or a specific gift by ID
  app.get('/api/gifts/active', (req: Request, res: Response) => {
    const gifts = readGifts();
    const requestedId = typeof req.query.id === 'string' ? req.query.id.trim() : '';

    if (requestedId) {
      const found = gifts.find((g) => g.id === requestedId);
      if (!found) {
        res.status(404).json({ error: 'لم يتم العثور على هذا الإهداء.' });
        return;
      }
      res.json({ gift: found });
      return;
    }

    const sorted = [...gifts].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const primary = sorted.find((g) => g.isPrimary) ?? sorted[0] ?? null;
    res.json({ gift: primary });
  });

  // Chunked Upload Step 1: Initialize upload session (bypasses 32MB proxy request cap)
  app.post('/api/uploads/init', (req: Request, res: Response) => {
    const originalName =
      typeof req.body?.originalName === 'string' && req.body.originalName.trim()
        ? path.basename(req.body.originalName.trim())
        : 'birthday-video.mp4';
    const mimeType =
      typeof req.body?.mimeType === 'string' ? req.body.mimeType.trim() : 'video/mp4';
    const expectedSize = Number(req.body?.size);

    const ext = path.extname(originalName).toLowerCase();
    const isVideoMime = mimeType.startsWith('video/');
    if (!isVideoMime && !ALLOWED_EXTENSIONS.has(ext)) {
      res.status(400).json({ error: 'يرجى اختيار ملف فيديو صالح (MP4 أو MOV أو WebM).' });
      return;
    }

    if (!Number.isFinite(expectedSize) || expectedSize <= 0) {
      res.status(400).json({ error: 'حجم ملف الفيديو غير صالح.' });
      return;
    }

    if (expectedSize > 2 * 1024 * 1024 * 1024) {
      res.status(400).json({ error: 'الحد الأقصى لحجم الفيديو هو 2 جيجابايت.' });
      return;
    }

    const uploadId = crypto.randomBytes(8).toString('hex');
    const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.mp4';
    const gifts = readGifts();
    const setPrimary = req.body?.setPrimary === true || gifts.length === 0;
    const allowDownload = req.body?.allowDownload !== false;

    const session: UploadSession = {
      uploadId,
      tempFilename: `${uploadId}.part`,
      finalExt: safeExt,
      originalName,
      mimeType: inferMimeType(originalName, mimeType),
      expectedSize,
      bytesReceived: 0,
      title: sanitizeText(req.body?.title, 'هذه المفاجأة لك', 100),
      recipientName: sanitizeText(req.body?.recipientName, '', 80),
      closingMessage: sanitizeText(req.body?.closingMessage, 'كل عام وأنت بألف خير', 140),
      senderName: sanitizeText(req.body?.senderName, '', 80),
      allowDownload,
      setPrimary,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(getSessionPartPath(uploadId), Buffer.alloc(0));
    writeSession(session);

    res.status(201).json({
      uploadId,
      chunkSize: CHUNK_SIZE_BYTES,
    });
  });

  // Chunked Upload Step 2: Receive a <= 4MB binary chunk at offset
  app.post(
    '/api/uploads/:uploadId/chunk',
    express.raw({ type: 'application/octet-stream', limit: '8mb' }),
    (req: Request, res: Response) => {
      const uploadId = req.params.uploadId;
      const session = readSession(uploadId);
      if (!session) {
        res.status(404).json({ error: 'جلسة الرفع غير موجودة أو انتهت.' });
        return;
      }

      const chunk = req.body;
      if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
        res.status(400).json({ error: 'بيانات الجزء المرفوع فارغة.' });
        return;
      }

      const offset = Number(req.query.offset);
      if (!Number.isFinite(offset) || offset < 0 || offset > session.expectedSize) {
        res.status(400).json({ error: 'موضع الجزء غير صالح.' });
        return;
      }

      const partPath = getSessionPartPath(uploadId);
      const fd = fs.openSync(partPath, 'r+');
      try {
        fs.writeSync(fd, chunk, 0, chunk.length, offset);
      } finally {
        fs.closeSync(fd);
      }

      const endOffset = offset + chunk.length;
      if (endOffset > session.bytesReceived) {
        session.bytesReceived = endOffset;
        writeSession(session);
      }

      res.json({ bytesReceived: session.bytesReceived });
    }
  );

  // Chunked Upload Step 3: Finalize and permanently save the video
  app.post('/api/uploads/:uploadId/complete', (req: Request, res: Response) => {
    const uploadId = req.params.uploadId;
    const session = readSession(uploadId);
    if (!session) {
      res.status(404).json({ error: 'جلسة الرفع غير موجودة.' });
      return;
    }

    const partPath = getSessionPartPath(uploadId);
    if (!fs.existsSync(partPath)) {
      res.status(404).json({ error: 'ملف الفيديو المؤقت غير موجود.' });
      return;
    }

    const stat = fs.statSync(partPath);
    if (stat.size < session.expectedSize) {
      res.status(400).json({
        error: 'لم يكتمل رفع جميع أجزاء الفيديو بعد.',
      });
      return;
    }

    const finalFilename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${session.finalExt}`;
    const finalPath = path.join(VIDEOS_DIR, finalFilename);
    fs.renameSync(partPath, finalPath);

    const metaPath = getSessionMetaPath(uploadId);
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }

    const gifts = readGifts();
    const shouldBePrimary = session.setPrimary || gifts.length === 0;
    const updatedGifts = shouldBePrimary
      ? gifts.map((g) => ({ ...g, isPrimary: false }))
      : gifts;

    const id = crypto.randomBytes(5).toString('hex');
    const newGift: GiftRecord = {
      id,
      title: session.title,
      recipientName: session.recipientName,
      closingMessage: session.closingMessage,
      senderName: session.senderName,
      filename: finalFilename,
      originalName: session.originalName,
      mimeType: inferMimeType(finalFilename, session.mimeType),
      size: stat.size,
      allowDownload: session.allowDownload,
      isPrimary: shouldBePrimary,
      createdAt: new Date().toISOString(),
    };

    updatedGifts.push(newGift);
    writeGifts(updatedGifts);

    res.status(201).json({ gift: newGift });
  });

  // Cancel / cleanup an in-progress upload session
  app.delete('/api/uploads/:uploadId', (req: Request, res: Response) => {
    const uploadId = req.params.uploadId;
    if (!isValidUploadId(uploadId)) {
      res.status(400).json({ error: 'معرف الجلسة غير صالح.' });
      return;
    }
    const partPath = getSessionPartPath(uploadId);
    const metaPath = getSessionMetaPath(uploadId);
    if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
    res.json({ ok: true });
  });

  // Legacy single-request upload fallback for small files (< 30MB)
  app.post('/api/gifts', (req: Request, res: Response) => {
    upload.single('video')(req, res, (err: unknown) => {
      if (err) {
        const message =
          err instanceof Error ? err.message : 'تعذر رفع الفيديو، يرجى المحاولة مرة أخرى.';
        res.status(400).json({ error: message });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'لم يتم إرفاق أي ملف فيديو.' });
        return;
      }

      const gifts = readGifts();
      const setPrimary =
        req.body?.setPrimary === 'true' || req.body?.setPrimary === true || gifts.length === 0;

      const updatedGifts = setPrimary
        ? gifts.map((g) => ({ ...g, isPrimary: false }))
        : gifts;

      const id = crypto.randomBytes(5).toString('hex');
      const allowDownload =
        req.body?.allowDownload === undefined
          ? true
          : req.body.allowDownload === 'true' || req.body.allowDownload === true;

      const newGift: GiftRecord = {
        id,
        title: sanitizeText(req.body?.title, 'هذه المفاجأة لك', 100),
        recipientName: sanitizeText(req.body?.recipientName, '', 80),
        closingMessage: sanitizeText(req.body?.closingMessage, 'كل عام وأنت بألف خير', 140),
        senderName: sanitizeText(req.body?.senderName, '', 80),
        filename: file.filename,
        originalName: file.originalname || `birthday-gift-${id}.mp4`,
        mimeType: inferMimeType(file.filename, file.mimetype),
        size: file.size,
        allowDownload,
        isPrimary: setPrimary,
        createdAt: new Date().toISOString(),
      };

      updatedGifts.push(newGift);
      writeGifts(updatedGifts);

      res.status(201).json({ gift: newGift });
    });
  });

  // Update gift presentation details or promote to primary
  app.patch('/api/gifts/:id', (req: Request, res: Response) => {
    const id = req.params.id;
    const gifts = readGifts();
    const index = gifts.findIndex((g) => g.id === id);
    if (index === -1) {
      res.status(404).json({ error: 'الإهداء غير موجود.' });
      return;
    }

    const existing = gifts[index];
    const makePrimary = req.body?.isPrimary === true;

    const updatedList = gifts.map((g, idx) => {
      if (idx === index) {
        return {
          ...existing,
          title:
            req.body?.title !== undefined
              ? sanitizeText(req.body.title, 'هذه المفاجأة لك', 100)
              : existing.title,
          recipientName:
            req.body?.recipientName !== undefined
              ? sanitizeText(req.body.recipientName, '', 80)
              : existing.recipientName,
          closingMessage:
            req.body?.closingMessage !== undefined
              ? sanitizeText(req.body.closingMessage, 'كل عام وأنت بألف خير', 140)
              : existing.closingMessage,
          senderName:
            req.body?.senderName !== undefined
              ? sanitizeText(req.body.senderName, '', 80)
              : existing.senderName,
          allowDownload:
            typeof req.body?.allowDownload === 'boolean'
              ? req.body.allowDownload
              : existing.allowDownload,
          isPrimary: makePrimary ? true : existing.isPrimary,
        };
      }
      return makePrimary ? { ...g, isPrimary: false } : g;
    });

    writeGifts(updatedList);
    res.json({ gift: updatedList[index] });
  });

  // Permanently delete a gift and its video file
  app.delete('/api/gifts/:id', (req: Request, res: Response) => {
    const id = req.params.id;
    const gifts = readGifts();
    const target = gifts.find((g) => g.id === id);
    if (!target) {
      res.status(404).json({ error: 'الإهداء غير موجود.' });
      return;
    }

    const remaining = gifts.filter((g) => g.id !== id);
    if (target.isPrimary && remaining.length > 0) {
      remaining.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      remaining[0] = { ...remaining[0], isPrimary: true };
    }
    writeGifts(remaining);

    const filePath = path.join(VIDEOS_DIR, path.basename(target.filename));
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, () => {});
    }

    res.json({ ok: true });
  });

  // High-definition lossless video streaming with HTTP 206 Range support
  app.get('/api/videos/:id', (req: Request, res: Response) => {
    const id = req.params.id;
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      res.status(400).json({ error: 'معرف غير صالح.' });
      return;
    }

    const gifts = readGifts();
    const gift = gifts.find((g) => g.id === id);
    if (!gift) {
      res.status(404).json({ error: 'الفيديو غير موجود.' });
      return;
    }

    const videoPath = path.join(VIDEOS_DIR, path.basename(gift.filename));
    if (!fs.existsSync(videoPath)) {
      res.status(404).json({ error: 'ملف الفيديو مفقود.' });
      return;
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const contentType = inferMimeType(videoPath, gift.mimeType);
    const isDownload = req.query.download === '1';
    const MAX_STREAM_CHUNK = 4 * 1024 * 1024; // 4 MB per 206 response (under Cloud Run 32 MB cap)

    if (isDownload) {
      const encodedName = encodeURIComponent(gift.originalName || `birthday-gift-${gift.id}.mp4`);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
    }

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const rawEnd = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (
        Number.isNaN(start) ||
        Number.isNaN(rawEnd) ||
        start < 0 ||
        start >= fileSize ||
        rawEnd < start
      ) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }

      const end = Math.min(rawEnd, start + MAX_STREAM_CHUNK - 1, fileSize - 1);
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(videoPath, { start, end });
      stream.on('error', () => {
        if (!res.headersSent) res.status(500).end();
      });
      stream.pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(videoPath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  });

  // Global API error guard
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'حدث خطأ في الخادم.';
    res.status(500).json({ error: message });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
