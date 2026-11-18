import { describe, expect, it } from 'vite-plus/test';
import { getBrowseList, setBrowseList } from './context';

describe('the list a photo page steps through', () => {
  it('is the one last browsed in the same view: the author’s own list never reaches the visitor view, or back', () => {
    setBrowseList(['public', 'private'], false);
    expect(getBrowseList(false)).toEqual(['public', 'private']);
    expect(getBrowseList(true)).toBeNull();
    setBrowseList(['public'], true);
    expect(getBrowseList(true)).toEqual(['public']);
    expect(getBrowseList(false)).toBeNull();
    setBrowseList(null, true);
    expect(getBrowseList(true)).toBeNull();
    expect(getBrowseList(false)).toBeNull();
  });
});
