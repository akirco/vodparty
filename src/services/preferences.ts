import { storage } from './storage';

const getHiddenCategoriesKey = (sourceId: string) => 
  `apple_cms_hidden_categories_${sourceId}`;

export const getHiddenCategories = async (sourceId: string): Promise<number[]> => {
  if (typeof window === 'undefined') return [];
  const stored = await storage.get<number[]>(getHiddenCategoriesKey(sourceId));
  return stored || [];
};

export const saveHiddenCategories = async (sourceId: string, hiddenIds: number[]) => {
  if (typeof window === 'undefined') return;
  await storage.set(getHiddenCategoriesKey(sourceId), hiddenIds);
};
