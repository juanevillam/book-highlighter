import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { STATE_LAB } from '../dev/flags';
import { useUiStateLab } from '../dev/uiStateLab';

type DevSettingsState = {
  stateLabBar: boolean;
  setStateLabBar: (on: boolean) => void;
};

export const useDevSettingsStore = create<DevSettingsState>()(
  persist(
    set => ({
      stateLabBar: STATE_LAB,
      setStateLabBar: stateLabBar => {
        set({ stateLabBar });
        if (!stateLabBar) {
          useUiStateLab.getState().resetAll();
        }
      },
    }),
    {
      name: 'book-highlighter-dev-settings',
    },
  ),
);
