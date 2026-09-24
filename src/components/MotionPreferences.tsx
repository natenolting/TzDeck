"use client";

import { MotionConfig } from "framer-motion";

/**
 * Makes every Framer Motion animation honour the visitor's reduced-motion
 * setting. With `reducedMotion="user"`, transform and layout animations jump
 * straight to their end state when the OS asks for less motion, while opacity
 * and color still fade. It lives in its own client module because the root
 * layout is a server component.
 */
export default function MotionPreferences({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
