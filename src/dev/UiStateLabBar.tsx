import {
  ACCOUNT_STATES,
  CHAPTER_DETAIL_STATES,
  CHAPTERS_STATES,
  HOME_STATES,
  READER_STATES,
  SCANNER_STATES,
  TROPHIES_STATES,
  UI_STATE_LAB,
  useUiStateLab,
  type AccountState,
  type ChapterDetailState,
  type ChaptersState,
  type HomeState,
  type LabScreen,
  type ReaderLabState,
  type ScannerState,
  type TrophiesState,
} from './uiStateLab';
import { useDevSettingsStore } from '../store/devSettings';
import { StateLab, type StateLabGroup } from '../ui/StateLab';

export function UiStateLabBar({
  screens,
  bottomOffset = 0,
}: {
  screens: readonly LabScreen[];
  bottomOffset?: number;
}) {
  const barVisible = useDevSettingsStore(s => s.stateLabBar);

  const home = useUiStateLab(s => s.home);
  const chapters = useUiStateLab(s => s.chapters);
  const chapter = useUiStateLab(s => s.chapter);
  const scanner = useUiStateLab(s => s.scanner);
  const reader = useUiStateLab(s => s.reader);
  const account = useUiStateLab(s => s.account);
  const trophies = useUiStateLab(s => s.trophies);

  const setHome = useUiStateLab(s => s.setHome);
  const setChapters = useUiStateLab(s => s.setChapters);
  const setChapter = useUiStateLab(s => s.setChapter);
  const setScanner = useUiStateLab(s => s.setScanner);
  const setReader = useUiStateLab(s => s.setReader);
  const setAccount = useUiStateLab(s => s.setAccount);
  const setTrophies = useUiStateLab(s => s.setTrophies);

  if (!UI_STATE_LAB || !barVisible || screens.length === 0) return null;

  const allGroups: Record<LabScreen, StateLabGroup> = {
    home: {
      key: 'home',
      label: 'Home',
      onChange: v => setHome(v as HomeState),
      states: HOME_STATES,
      value: home,
    },
    chapters: {
      key: 'chapters',
      label: 'Chapters',
      onChange: v => setChapters(v as ChaptersState),
      states: CHAPTERS_STATES,
      value: chapters,
    },
    chapter: {
      key: 'chapter',
      label: 'Chapter',
      onChange: v => setChapter(v as ChapterDetailState),
      states: CHAPTER_DETAIL_STATES,
      value: chapter,
    },
    scanner: {
      key: 'scanner',
      label: 'Scanner',
      onChange: v => setScanner(v as ScannerState),
      states: SCANNER_STATES,
      value: scanner,
    },
    reader: {
      key: 'reader',
      label: 'Reader',
      onChange: v => setReader(v as ReaderLabState),
      states: READER_STATES,
      value: reader,
    },
    account: {
      key: 'account',
      label: 'Account',
      onChange: v => setAccount(v as AccountState),
      states: ACCOUNT_STATES,
      value: account,
    },
    trophies: {
      key: 'trophies',
      label: 'Trophies',
      onChange: v => setTrophies(v as TrophiesState),
      states: TROPHIES_STATES,
      value: trophies,
    },
  };

  return (
    <StateLab
      groups={screens.map(s => allGroups[s])}
      bottomOffset={bottomOffset}
    />
  );
}
