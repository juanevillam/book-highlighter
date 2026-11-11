import { getToken } from 'firebase/app-check';

import { appCheck, requireAuth } from './firebase';
import { mediaWorkerUrl } from './firebaseConfig';

export const MAX_IMAGE_UPLOAD_BYTES = 5_000_000;
const UPLOAD_TIMEOUT_MS = 120_000;

type ResourceType = 'image';

export class BackendRefusal extends Error {
  constructor(readonly reason: string) {
    super(`refused: ${reason}`);
    this.name = 'BackendRefusal';
  }
}

export class FileTooLargeError extends Error {
  constructor(readonly resourceType: ResourceType) {
    super(`${resourceType} over the size limit`);
    this.name = 'FileTooLargeError';
  }
}

const callBackend = async <T>(name: string, data: unknown = {}): Promise<T> => {
  const user = requireAuth().currentUser;
  if (!user) throw new Error('Not signed in');

  const [token, check] = await Promise.all([
    user.getIdToken(),
    appCheck
      ? getToken(appCheck).then(
          result => result.token,
          () => null,
        )
      : Promise.resolve(null),
  ]);

  const response = await fetch(`${mediaWorkerUrl}/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(check ? { 'X-Firebase-AppCheck': check } : {}),
    },
    body: JSON.stringify({ data }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;

    throw typeof body?.error === 'string'
      ? new BackendRefusal(body.error)
      : new Error(`${name} failed: HTTP ${response.status}`);
  }

  return ((await response.json()) as { result: T }).result;
};

type SignedUpload = {
  apiKey: string;
  cloudName: string;
  params: Record<string, string>;
  signature: string;
};

export type Asset = { publicId: string; url: string };

/**
 * Signed Cloudinary image upload via the media Worker (`book-highlighter/covers/{uid}/`).
 */
export const uploadImage = async (
  file: Blob,
  folderKind: 'covers' | 'profiles' = 'covers',
): Promise<Asset> => {
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new FileTooLargeError('image');
  }

  const { apiKey, cloudName, params, signature } =
    await callBackend<SignedUpload>('signUpload', {
      resourceType: 'image',
      folder: folderKind,
    });

  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    form.append(key, value);
  }
  form.append('api_key', apiKey);
  form.append('signature', signature);
  form.append('file', file);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    throw new Error(`Cloudinary upload failed: HTTP ${response.status}`);
  }

  const parsed = (await response.json()) as {
    public_id: string;
    secure_url: string;
  };

  return {
    publicId: parsed.public_id,
    url: parsed.secure_url,
  };
};

export const destroyAsset = (
  publicId: string,
  resourceType: ResourceType = 'image',
) =>
  publicId
    ? callBackend('destroyMyAsset', { publicId, resourceType }).catch(error =>
        console.warn('destroyMyAsset', error),
      )
    : Promise.resolve();

export const uploadFailureKey = (error: unknown, fallback: string): string => {
  if (error instanceof FileTooLargeError) return 'snackbar.picture-too-large';

  if (error instanceof BackendRefusal) {
    switch (error.reason) {
      case 'library-full':
      case 'storage-full':
        return 'snackbar.library-full';
      case 'daily-limit':
        return 'snackbar.daily-limit';
    }
  }

  return fallback;
};

export const cleanupMyMedia = () =>
  callBackend<{ destroyed: number }>('cleanupMyMedia');
