import { useCallback, useEffect, useState } from 'react';

/** How long the fields stay after each change under "切换后 6 秒". */
const BRIEF_MS = 6000;

/**
 * The caption's fields on and off (I). With `brief` they also hide 6 s after every change of photo (`run`, `photoId`);
 * pressing I while they are hidden that way brings them back for another 6 s.
 */
export function useCaptionToggle(brief: boolean, run: number, photoId: string | undefined) {
  const [fieldsOff, setFieldsOff] = useState(false);
  const [briefOver, setBriefOver] = useState(false);
  const [peek, setPeek] = useState(0);

  const briefHidden = brief && briefOver;
  const visible = !fieldsOff && !briefHidden;
  const toggle = useCallback(() => {
    if (visible) {
      setFieldsOff(true);
      return;
    }
    setFieldsOff(false);
    if (briefHidden) setPeek((p) => p + 1);
  }, [visible, briefHidden]);

  useEffect(() => {
    setBriefOver(false);
    if (!brief) return;
    const t = window.setTimeout(() => setBriefOver(true), BRIEF_MS);
    return () => window.clearTimeout(t);
  }, [run, peek, brief, photoId]);

  return { visible, toggle };
}
