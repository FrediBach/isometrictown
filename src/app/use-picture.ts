import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import type { Picture } from '../image';
import { loadPicture, pictureBlob, readPicture, savePicture, UnreadableImage } from './image-store';

/** Where the picture for image mode stands: none chosen, being read, on hand, or not stored in this browser. */
export type PictureStatus = 'none' | 'loading' | 'ready' | 'missing';

export type PictureState = {
  picture: Picture | null;
  /** An object URL of the normalised picture, for showing it. */
  url: string | null;
  status: PictureStatus;
  /** Why the last file chosen couldn't be used. */
  error: string;
  /** The picture on hand right now, for the renderer, which reads it outside React. */
  current: () => Picture | null;
  /** Read and keep a file; resolves to the picture, or null if it couldn't be read. */
  choose: (file: File) => Promise<Picture | null>;
};

/**
 * The picture with id `id`, loaded from storage when the id changes, plus a way to choose a new
 * one. `onLoaded` runs when a stored picture arrives, so the drawing can be made.
 */
export function usePicture(id: string, onLoaded: () => void): PictureState {
  const [picture, setPicture] = useState<Picture | null>(null);
  const [missing, setMissing] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [shown, setShown] = useState<{ id: string; url: string } | null>(null);
  const ref = useRef<Picture | null>(null);
  const loaded = useEffectEvent(onLoaded);
  const current = useCallback(() => ref.current, []);

  useEffect(() => {
    if (!id || ref.current?.id === id) return;
    let cancelled = false;
    void loadPicture(id).then((p) => {
      if (cancelled) return;
      if (!p) {
        setMissing(id);
        return;
      }
      ref.current = p;
      setPicture(p);
      loaded();
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!picture) return;
    let live = true;
    let url = '';
    void pictureBlob(picture).then((blob) => {
      if (!live) return;
      url = URL.createObjectURL(blob);
      setShown({ id: picture.id, url });
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [picture]);

  async function choose(file: File): Promise<Picture | null> {
    setReading(true);
    setError('');
    try {
      const p = await readPicture(file, file.name);
      void savePicture(p);
      ref.current = p;
      setPicture(p);
      return p;
    } catch (e) {
      setError(e instanceof UnreadableImage ? e.message : 'That image couldn’t be read.');
      return null;
    } finally {
      setReading(false);
    }
  }

  const here = picture?.id === id ? picture : null;
  const status: PictureStatus = reading ? 'loading' : !id ? 'none' : here ? 'ready' : missing === id ? 'missing' : 'loading';
  return { picture: here, url: here && shown?.id === here.id ? shown.url : null, status, error, current, choose };
}
