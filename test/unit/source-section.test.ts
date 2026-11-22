import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { SettingsContext } from '@/app/settings-context';
import type { PictureState } from '@/app/use-picture';
import { LightSection, PensSection, SeedSection, SheetSection, SourceSection, TitleSection, TownSection, ViewSection } from '@/components/sections';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';

test('each mode opens only its source chooser and orders the folded groups below it', () => {
  const noop = () => {};
  const picture: PictureState = { picture: null, url: null, status: 'missing', error: '', current: () => null, choose: async () => null, cancelChoice: noop };
  const section = (source: Settings['source']) => renderToStaticMarkup(createElement(
    SettingsContext, { value: { set: { ...DEFAULT_SETTINGS, source }, change: noop } },
    createElement(Fragment, null,
      createElement(SourceSection, { picture, onFile: noop, onSource: noop, onGoTo: noop, onMapReady: noop, onMapMove: noop, mask: null, onMask: noop, pin: null, onPin: noop }),
      createElement(ViewSection), createElement(TownSection, {}), createElement(LightSection),
      createElement(TitleSection), createElement(SheetSection),
      createElement(PensSection, { onPalette: noop, onPen: noop, onPenCommit: noop }),
      createElement(SeedSection, { onSeed: noop, onUnlock: noop }),
    ),
  ));

  const map = section('map');
  expect(map).toContain('class="locator ');
  const image = section('image');
  expect(image).toContain('aria-label="Image well"');
  const groups = (html: string) => [...html.matchAll(/<button(?=[^>]*data-slot="collapsible-trigger")[^>]+aria-expanded="(true|false)"[^>]*>(.*?)<\/button>/gs)]
    .map(([, expanded, content]) => [content.match(/<span[^>]*>([^<>]+)<\/span><\/span>/)?.[1], expanded]);
  expect(groups(map)).toEqual([
    ['Place', 'true'], ...['View', 'Drawing detail', 'Town', 'Light', 'Title', 'Sheet', 'Pens', 'Seed'].map((title) => [title, 'false']),
  ]);
  expect(groups(image)).toEqual([
    ['Image', 'true'], ...['Masks', 'Pins', 'Image tone', 'Neighbourhoods and buildings', 'Streets', 'View', 'Town', 'Light', 'Title', 'Sheet', 'Pens', 'Seed']
      .map((title) => [title, 'false']),
  ]);
  expect(map).not.toContain('Neighbourhoods and buildings');
  expect(image).not.toContain('class="locator ');
});
