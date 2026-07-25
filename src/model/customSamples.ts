// Samples you save yourself, kept in the browser so they outlive a reload.
//
// The built-in samples live in code (samples.ts). These are the ones you build in
// the app — arrange strands, pick over/under with the Weave tool, then save. They
// go in localStorage, which means they survive a refresh and a closed tab on this
// browser, and they are yours alone: nothing is uploaded anywhere.
//
// A saved sample is a plain SceneFile, so "Copy JSON" hands you the exact text
// that can be pasted back in here, sent to someone else, or dropped into
// samples.ts to become a permanent built-in.

import { Scene3D } from './types';
import { SceneFile, sceneToFile } from './sceneIO';

const KEY = 'scoubidou3d.samples.v1';

export interface CustomSample {
  id: string;
  /** Millisecond timestamp — newest first in the list. */
  saved: number;
  scene: SceneFile;
}

// localStorage throws in private-mode browsers and when the quota is full, and is
// absent entirely in some embeddings. Every access is guarded so a storage
// failure degrades to "no saved samples" instead of breaking the app.
function store(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = '__scoubidou_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function listCustom(): CustomSample[] {
  const s = store();
  if (!s) return [];
  try {
    const raw = s.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as CustomSample[])
      .filter((c) => c && typeof c.id === 'string' && c.scene && Array.isArray(c.scene.strands))
      .sort((a, b) => (b.saved ?? 0) - (a.saved ?? 0));
  } catch {
    return [];
  }
}

function write(list: CustomSample[]): boolean {
  const s = store();
  if (!s) return false;
  try {
    s.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false; // out of quota
  }
}

/** True when saved samples can be kept at all (false in private-mode browsers). */
export function storageAvailable(): boolean {
  return store() !== null;
}

/**
 * Save the current scene under `name`. Saving again with a name that already
 * exists replaces it, so iterating on one design doesn't pile up duplicates.
 */
export function saveCustom(scene: Scene3D, name: string): CustomSample | null {
  const file = sceneToFile(scene);
  file.name = name;
  const list = listCustom().filter((c) => c.scene.name !== name);
  const entry: CustomSample = { id: `custom:${name}`, saved: Date.now(), scene: file };
  list.unshift(entry);
  return write(list) ? entry : null;
}

export function deleteCustom(id: string): void {
  write(listCustom().filter((c) => c.id !== id));
}

export function getCustom(id: string): CustomSample | null {
  return listCustom().find((c) => c.id === id) ?? null;
}
