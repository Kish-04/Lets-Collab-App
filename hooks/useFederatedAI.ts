import { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as cocossd from '@tensorflow-models/coco-ssd';

export function useFederatedAI(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  isActive: boolean,
  onViolation: (type: string, message: string) => void
) {
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const modelRef = useRef<cocossd.ObjectDetection | null>(null);
  const loopRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    const loadModel = async () => {
      try {
        await tf.ready();
        const model = await cocossd.load();
        if (mounted) {
          modelRef.current = model;
          setIsModelLoaded(true);
        }
      } catch (err) {
        console.error("Failed to load COCO-SSD model:", err);
      }
    };
    loadModel();
    return () => { mounted = false; };
  }, []);

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

          if (cellPhoneDetected) {
            onViolation('AI_ALERT', 'Unauthorized device (cell phone) detected in camera view.');
          }
          if (personCount > 1) {
            onViolation('AI_ALERT', `Multiple people (${personCount}) detected in camera view.`);
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
  }, [isActive, isModelLoaded, videoRef, onViolation]);

  return { isModelLoaded };
}
