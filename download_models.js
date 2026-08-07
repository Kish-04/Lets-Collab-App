const fs = require('fs');
const path = require('path');
const https = require('https');

const downloadFile = (url, dest) => {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, response => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log(`Downloaded ${url}`);
        resolve();
      });
    }).on('error', err => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
};

const run = async () => {
  const modelsDir = path.join(__dirname, 'public', 'models');
  const wasmDir = path.join(__dirname, 'public', 'wasm');
  
  if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });
  if (!fs.existsSync(wasmDir)) fs.mkdirSync(wasmDir, { recursive: true });

  const files = [
    { url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', dest: path.join(modelsDir, 'face_landmarker.task') },
    { url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite', dest: path.join(modelsDir, 'efficientdet_lite0.tflite') },
    { url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm/vision_wasm_internal.js', dest: path.join(wasmDir, 'vision_wasm_internal.js') },
    { url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm/vision_wasm_internal.wasm', dest: path.join(wasmDir, 'vision_wasm_internal.wasm') },
    { url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm/vision_wasm_nosimd_internal.js', dest: path.join(wasmDir, 'vision_wasm_nosimd_internal.js') },
    { url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm/vision_wasm_nosimd_internal.wasm', dest: path.join(wasmDir, 'vision_wasm_nosimd_internal.wasm') }
  ];

  for (const file of files) {
    try {
      await downloadFile(file.url, file.dest);
    } catch (e) {
      console.error(`Error downloading ${file.url}:`, e);
    }
  }
};

run();
