'use client';

import { useEffect } from 'react';
import { bootMotion } from '../../motion/core.ts';
import { initHomeScenes } from '../../motion/scenes/index.ts';

/** Registriert alle Bühnen der Startseite bei der Motion-Engine. */
export function HomeScenes() {
  useEffect(() => {
    bootMotion();
    return initHomeScenes();
  }, []);
  return null;
}
