// The photo ids of the list the visitor last browsed (filtered gallery, a place, a map selection),
// in display order. The photo page steps through it with ←/→; it falls back to the full gallery order
// when the list is missing (page reload) or does not contain the photo.

let current: readonly string[] | null = null;

export const setBrowseList = (ids: readonly string[] | null): void => {
  current = ids;
};
export const getBrowseList = (): readonly string[] | null => current;
