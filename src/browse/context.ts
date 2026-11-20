// The photo ids of the list the visitor last browsed (filtered gallery, a place, a map selection),
// in display order. The photo page steps through it with ←/→; it falls back to the full gallery order
// when the list is missing (page reload) or does not contain the photo.
//
// A list browsed in the visitor view (lib/visitor.ts) is kept apart from one browsed as oneself: the author's list
// holds photos a visitor cannot open, and stepping into them would show the view something no visitor sees.

let current: { ids: readonly string[]; visitor: boolean } | null = null;

export const setBrowseList = (ids: readonly string[] | null, visitor: boolean): void => {
  current = ids && { ids, visitor };
};
/** The list last browsed in the same view, if any. */
export const getBrowseList = (visitor: boolean): readonly string[] | null => (current?.visitor === visitor ? current.ids : null);
