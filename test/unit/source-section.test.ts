import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { SettingsContext } from '@/app/settings-context';
import type { PictureState } from '@/app/use-picture';
import { SourceSection } from '@/components/sections';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';

test('opening an image link mounts the image well without a map locator', () => {
  const noop = () => {};
  const picture: PictureState = { picture: null, url: null, status: 'missing', error: '', current: () => null, choose: async () => null, cancelChoice: noop };
  const section = (source: Settings['source'], imagePreserveSpace = false) => renderToStaticMarkup(createElement(
    SettingsContext, { value: { set: { ...DEFAULT_SETTINGS, source, imagePreserveSpace }, change: noop } },
    createElement(SourceSection, { picture, onFile: noop, onSource: noop, onGoTo: noop, onMapReady: noop, onMapMove: noop }),
  ));

  const map = section('map');
  expect(map).toContain('class="locator ');
  const image = section('image');
  expect(image).toContain('aria-label="Image well"');
  for (const control of ['Height from image', 'Building density from image', 'Hatching from image', 'Streets follow image lines', 'Preserve empty space']) {
    expect(image).toContain(control);
    expect(map).not.toContain(control);
  }
  expect(image).not.toContain('Highlight cutoff');
  expect(section('image', true)).toContain('Highlight cutoff');
  expect(image).not.toContain('class="locator ');
});
