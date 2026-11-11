import { type BookBody, type Chapter, type Highlight } from '../books';

export const moveEntry = <T>(items: T[], from: number, to: number): T[] => {
  if (from === to || from < 0 || from >= items.length) return items;

  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved as T);

  return next;
};

export const finalIndexForMove = (from: number, destination: number) =>
  from < destination ? destination - 1 : destination;

const mapChapter = (
  body: BookBody,
  chapterId: string,
  edit: (chapter: Chapter) => Chapter,
): BookBody => ({
  ...body,
  chapters: body.chapters.map(chapter =>
    chapter.id === chapterId ? edit(chapter) : chapter,
  ),
});

export const addChapter = (
  body: BookBody,
  chapter: { id: string; name: string },
): BookBody => ({
  ...body,
  chapters: [
    ...body.chapters,
    { highlights: [], id: chapter.id, name: chapter.name, pages: '' },
  ],
});

export const removeChapter = (body: BookBody, chapterId: string): BookBody => ({
  ...body,
  chapters: body.chapters.filter(chapter => chapter.id !== chapterId),
});

export const moveChapter = (
  body: BookBody,
  from: number,
  to: number,
): BookBody => ({ ...body, chapters: moveEntry(body.chapters, from, to) });

export const updateChapter = (
  body: BookBody,
  chapterId: string,
  fields: Partial<Pick<Chapter, 'name' | 'pages'>>,
): BookBody =>
  mapChapter(body, chapterId, chapter => ({ ...chapter, ...fields }));

export const addHighlight = (
  body: BookBody,
  chapterId: string,
  highlight: Highlight,
): BookBody =>
  mapChapter(body, chapterId, chapter => ({
    ...chapter,
    highlights: [...chapter.highlights, highlight],
  }));

export const updateHighlight = (
  body: BookBody,
  chapterId: string,
  highlight: Highlight,
): BookBody =>
  mapChapter(body, chapterId, chapter => ({
    ...chapter,
    highlights: chapter.highlights.map(entry =>
      entry.id === highlight.id ? highlight : entry,
    ),
  }));

export const removeHighlight = (
  body: BookBody,
  chapterId: string,
  highlightId: string,
): BookBody =>
  mapChapter(body, chapterId, chapter => ({
    ...chapter,
    highlights: chapter.highlights.filter(entry => entry.id !== highlightId),
  }));

export const moveHighlight = (
  body: BookBody,
  chapterId: string,
  from: number,
  to: number,
): BookBody =>
  mapChapter(body, chapterId, chapter => ({
    ...chapter,
    highlights: moveEntry(chapter.highlights, from, to),
  }));
