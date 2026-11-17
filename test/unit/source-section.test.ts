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
  const section = (source: Settings['source']) => renderToStaticMarkup(createElement(
    SettingsContext, { value: { set: { ...DEFAULT_SETTINGS, source }, change: noop } },
    createElement(SourceSection, { picture, onFile: noop, onSource: noop, onGoTo: noop, onMapReady: noop, onMapMove: noop }),
  ));

  const map = section('map');
  expect(map).toContain('class="locator ');
  expect(map).not.toContain('Height from image');
  const image = section('image');
  expect(image).toContain('aria-label="Image well"');
  expect(image).toContain('Height from image');
  expect(image).not.toContain('class="locator ');
});
