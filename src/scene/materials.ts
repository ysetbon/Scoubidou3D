/** Surface recipes shared by the renderer and the Ribbon controls. */
export const MATERIAL_PRESETS = {
  classic: {
    label: 'Classic',
    roughness: 0.5,
    metalness: 0.04,
    opacity: 1,
    transmission: 0,
    ior: 1.45,
  },
  leather: {
    label: 'Leather',
    roughness: 0.9,
    metalness: 0,
    opacity: 1,
    transmission: 0,
    ior: 1.45,
  },
  glass: {
    label: 'Glass',
    roughness: 0.16,
    metalness: 0,
    opacity: 0.72,
    transmission: 0.68,
    ior: 1.46,
  },
} as const;

export type MaterialPreset = keyof typeof MATERIAL_PRESETS;

