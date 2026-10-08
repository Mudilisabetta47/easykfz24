'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { afterNavigation, bootMotion } from '../motion/core.ts';

/** Bootet die Motion-Engine einmal und meldet Seitenwechsel. Rendert nichts. */
export function MotionProvider() {
  const pathname = usePathname();

  useEffect(() => {
    bootMotion();
  }, []);

  useEffect(() => {
    afterNavigation();
  }, [pathname]);

  return null;
}
