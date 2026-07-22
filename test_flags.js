const puppeteer = require('puppeteer');

async function testLaunch(args) {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      executablePath: 'D:/Major Project/DRCSFA/Decentralized Remote Collaborative System with Federated AI/b_qkshruWtwB6-1773162616837/chrome/win64-152.0.7943.0/chrome-win64/chrome.exe',
      args: args
    });
    await browser.close();
    return true;
  } catch (err) {
    return false;
  }
}

async function run() {
  const allFlags = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--window-size=1280,720',
      '--auto-accept-camera-and-microphone-capture'
  ];

  let currentFlags = [];
  for (let flag of allFlags) {
      const testSet = [...currentFlags, flag];
      console.log(`Testing: ${JSON.stringify(testSet)}`);
      const success = await testLaunch(testSet);
      if (success) {
          console.log(' -> SUCCESS');
          currentFlags = testSet;
      } else {
          console.log(` -> FAILED. The flag '${flag}' caused the crash when added!`);
      }
  }
  
  console.log('\\nFinal stable flag combination: ', JSON.stringify(currentFlags));
}

run();
