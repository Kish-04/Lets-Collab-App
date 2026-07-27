import { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as cocossd from '@tensorflow-models/coco-ssd';

export function useFederatedAI(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  isActive: boolean,
  onViolation: (type: string, message: string) => void
) {
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const modelRef = useRef<cocossd.ObjectDetection | null>(null);
  const loopRef = useRef<number | null>(null);
  const noPersonFramesRef = useRef(0);
  const onViolationRef = useRef(onViolation);

  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  useEffect(() => {
    if (!isActive || modelRef.current) return;
    let mounted = true;
    const loadModel = async () => {
      try {
        setLoadError('');
        await tf.ready();
        const model = await cocossd.load();
        if (mounted) {
          modelRef.current = model;
          setIsModelLoaded(true);
        }
      } catch (err) {
        console.error("Failed to load COCO-SSD model:", err);
        if (mounted) setLoadError(err instanceof Error ? err.message : 'Failed to load object detection model');
      }
    };
    loadModel();
    return () => { mounted = false; };
  }, [isActive]);

  useEffect(() => {
    if (!isActive || !isModelLoaded || !videoRef.current) return;

    const detectFrame = async () => {
      if (videoRef.current && videoRef.current.readyState === 4 && modelRef.current) {
        try {
          const predictions = await modelRef.current.detect(videoRef.current);
          let personCount = 0;
          let cellPhoneDetected = false;

          for (const p of predictions) {
            // Check for high confidence matches
            if (p.score > 0.5) {
              if (p.class === 'person') personCount++;
              if (p.class === 'cell phone') cellPhoneDetected = true;
            }
          }

          if (personCount === 0) {
            noPersonFramesRef.current += 1;
          } else {
            noPersonFramesRef.current = 0;
          }

          if (cellPhoneDetected) {
            onViolationRef.current('AI_ALERT', 'Unauthorized device (cell phone) detected in camera view.');
          }
          if (personCount > 1) {
            onViolationRef.current('AI_ALERT', `Multiple people (${personCount}) detected in camera view.`);
          }
          if (noPersonFramesRef.current >= 3) {
            noPersonFramesRef.current = 0;
            onViolationRef.current('AI_ALERT', 'No person detected in camera view.');
          }
        } catch (err) {
          console.warn("Detection error:", err);
        }
      }
    };

    // Run inference every 3 seconds to save CPU
    loopRef.current = window.setInterval(detectFrame, 3000);

    return () => {
      if (loopRef.current !== null) {
        window.clearInterval(loopRef.current);
      }
    };
  }, [isActive, isModelLoaded, videoRef]);

  return { isModelLoaded, loadError };
}
