const UPLOAD_SEGMENT = '/image/upload/';

/**
 * Rewrite a stored Cloudinary cover-art URL to a display-sized variant:
 * `w_<2x>,c_limit,q_auto,f_auto` inserted after `/image/upload/`.
 */
export const thumbUrl = (url: string, displayWidth: number): string => {
  const index = url.indexOf(UPLOAD_SEGMENT);

  if (!url.includes('res.cloudinary.com') || index === -1) return url;

  const rest = url.slice(index + UPLOAD_SEGMENT.length);

  if (rest.startsWith('w_') || rest.startsWith('q_')) return url;

  const width = Math.min(Math.round(displayWidth * 2), 2048);

  return url.replace(
    UPLOAD_SEGMENT,
    `${UPLOAD_SEGMENT}w_${width},c_limit,q_auto,f_auto/`,
  );
};
