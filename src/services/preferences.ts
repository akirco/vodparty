const HIDDEN_CATEGORIES_KEY = 'apple_cms_hidden_categories';

export const getHiddenCategories = (): number[] => {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(HIDDEN_CATEGORIES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

export const saveHiddenCategories = (hiddenIds: number[]) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(HIDDEN_CATEGORIES_KEY, JSON.stringify(hiddenIds));
};
