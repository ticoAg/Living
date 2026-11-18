import { describe, expect, it } from 'vite-plus/test';
import { isVisitorSearch, keepVisitor, withoutVisitor, withVisitor } from './visitor';

describe('withVisitor', () => {
  it('keeps the visitor view on the pages a visitor can open, with their query and fragment', () => {
    expect(withVisitor('/')).toBe('/?as=visitor');
    expect(withVisitor('/@linzhi')).toBe('/@linzhi?as=visitor');
    expect(withVisitor('/%40linzhi/works')).toBe('/%40linzhi/works?as=visitor');
    expect(withVisitor('/@linzhi/articles')).toBe('/@linzhi/articles?as=visitor');
    expect(withVisitor('/e/en_1')).toBe('/e/en_1?as=visitor');
    expect(withVisitor('/t/th_1#item-3')).toBe('/t/th_1?as=visitor#item-3');
    expect(withVisitor('/projects/pj_1')).toBe('/projects/pj_1?as=visitor');
    expect(withVisitor('/p/ph_1?from=th_1')).toBe('/p/ph_1?from=th_1&as=visitor');
    expect(withVisitor('/place/poi_1')).toBe('/place/poi_1?as=visitor');
    expect(withVisitor('/?tag=lake')).toBe('/?tag=lake&as=visitor');
    expect(withVisitor('/map')).toBe('/map?as=visitor');
    expect(withVisitor('/index')).toBe('/index?as=visitor');
    expect(withVisitor('/themes')).toBe('/themes?as=visitor');
    expect(withVisitor('/living?src=theme&theme=th_1')).toBe('/living?src=theme&theme=th_1&as=visitor');
    expect(withVisitor('/e/en_1?as=visitor')).toBe('/e/en_1?as=visitor');
  });

  it('leaves the other pages, other sites and the files as they are', () => {
    for (const href of [
      '/e/en_1/edit',
      '/entries/new',
      '/projects',
      '/projects/new',
      '/projects/pj_1/edit',
      '/t/th_1/edit',
      '/themes/new',
      '/today',
      '/archive',
      '/archive/2026',
      '/search?q=湖',
      '/settings',
      '/login',
      '/upload',
      '/living/x',
      '/s/abc',
      '/@linzhi/photos',
      '/api/photos',
      '/media/a.jpg',
      'https://example.com/e/en_1',
      '//example.com/e/en_1',
      'e/en_1',
      'mailto:a@b.c'
    ]) {
      expect(withVisitor(href)).toBe(href);
    }
  });
});

describe('withoutVisitor', () => {
  it('takes the visitor view out and keeps the rest of the address', () => {
    expect(withoutVisitor('/@linzhi?as=visitor')).toBe('/@linzhi');
    expect(withoutVisitor('/p/ph_1?from=th_1&as=visitor#x')).toBe('/p/ph_1?from=th_1#x');
    expect(withoutVisitor('/?as=visitor&tag=lake')).toBe('/?tag=lake');
    expect(withoutVisitor('/e/en_1')).toBe('/e/en_1');
    expect(withoutVisitor('https://example.com/?as=visitor')).toBe('https://example.com/?as=visitor');
  });
});

describe('isVisitorSearch', () => {
  it('reads as=visitor from a query string, with or without its question mark', () => {
    expect(isVisitorSearch('as=visitor')).toBe(true);
    expect(isVisitorSearch('?tag=lake&as=visitor')).toBe(true);
    expect(isVisitorSearch('')).toBe(false);
    expect(isVisitorSearch('as=owner')).toBe(false);
    expect(isVisitorSearch('as=Visitor')).toBe(false);
  });
});

describe('keepVisitor', () => {
  it('adds the visitor view to a query a page writes for itself, only when the page is in it', () => {
    expect(keepVisitor('src=all&every=10', '?src=all&as=visitor')).toBe('src=all&every=10&as=visitor');
    expect(keepVisitor('', 'as=visitor')).toBe('as=visitor');
    expect(keepVisitor('src=all&every=10', '?src=all')).toBe('src=all&every=10');
    expect(keepVisitor('', '')).toBe('');
  });
});
