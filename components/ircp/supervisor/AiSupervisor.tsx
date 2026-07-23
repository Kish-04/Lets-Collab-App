"use client"

import React, { useEffect, useRef, useState } from 'react'
import * as tf from '@tensorflow/tfjs'
import * as cocoSsd from '@tensorflow-models/coco-ssd'
import * as faceapi from '@vladmandic/face-api'

interface AiSupervisorProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isActive: boolean;
  onMalpractice: (reason: string) => void;
}

export function AiSupervisor({ videoRef, isActive, onMalpractice }: AiSupervisorProps) {
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const loopRef = useRef<number>(0)
  const detectorRef = useRef<cocoSsd.ObjectDetection | null>(null)

  useEffect(() => {
    if (!isActive) return;

    let isMounted = true;

    const loadModels = async () => {
      try {
        await tf.ready();
        
        // Load COCO-SSD for phone detection
        detectorRef.current = await cocoSsd.load({ base: 'lite_mobilenet_v2' });

        // Load Face-API models from a public raw CDN
        const modelUrl = 'https://raw.githubusercontent.com/vladmandic/face-api/master/model/';
        await faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl);
        
        if (isMounted) setModelsLoaded(true);
      } catch (err: any) {
        if (isMounted) setLoadError(err.message || 'Failed to load ML models');
      }
    };

    loadModels();

    return () => {
      isMounted = false;
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
    }
  }, [isActive])

  useEffect(() => {
    if (!isActive || !modelsLoaded || !videoRef.current) return;

    let lastCheck = 0;
    
    const runDetection = async () => {
      const video = videoRef.current;
      if (!video || video.readyState !== 4) {
        loopRef.current = requestAnimationFrame(runDetection);
        return;
      }

      const now = performance.now();
      // Run heavy ML models only once every 500ms to save CPU
      if (now - lastCheck >= 500) {
        lastCheck = now;

        try {
          // 1. Face Detection
          const faces = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions());
          
          if (faces.length > 1) {
            onMalpractice(`Multiple faces detected! Count: ${faces.length}`);
          } else if (faces.length === 0) {
            onMalpractice(`No face detected in frame!`);
          }

          // 2. Object Detection (Cell Phone)
          if (detectorRef.current) {
            const predictions = await detectorRef.current.detect(video);
            const phone = predictions.find(p => p.class === 'cell phone');
            if (phone && phone.score > 0.6) {
              onMalpractice(`Unauthorized device detected: Cell Phone (${Math.round(phone.score * 100)}% certainty)`);
            }
          }
        } catch (e) {
          // Ignore transient errors during video element swapping
        }
      }

      loopRef.current = requestAnimationFrame(runDetection);
    };

    loopRef.current = requestAnimationFrame(runDetection);

    return () => {
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
    }
  }, [isActive, modelsLoaded, videoRef, onMalpractice]);

  if (!isActive) return null;

  return (
    <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-md border border-[var(--accent)] text-white text-xs px-2 py-1 rounded-md flex items-center gap-2">
      <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
      {loadError ? (
        <span className="text-red-400">ML Error</span>
      ) : !modelsLoaded ? (
        <span>Loading AI Models...</span>
      ) : (
        <span>AI Supervisor Active</span>
      )}
    </div>
  )
}
