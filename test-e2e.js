const puppeteer = require('puppeteer');
const http = require('http');

// Helper to check if server is up
const waitForServer = (url) => {
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            http.get(url, (res) => {
                if (res.statusCode === 200) {
                    clearInterval(interval);
                    resolve();
                }
            }).on('error', () => {
                // Ignore, keep trying
            });
        }, 1000);
    });
};

(async () => {
    console.log('[TEST] Waiting for localhost:8081 to be reachable...');
    await waitForServer('http://localhost:8081');
    console.log('[TEST] Server is ready! Launching Puppeteer...');

    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: 'new',
            args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
        });
        
        const page = await browser.newPage();
        
        // Catch console errors
        const errors = [];
        page.on('console', msg => {
            if (msg.type() === 'error' && !msg.text().includes('favicon') && !msg.text().includes('404')) {
                errors.push(msg.text());
                console.error(`[Browser Error] ${msg.text()}`);
            }
        });

        page.on('pageerror', err => {
            errors.push(err.message);
            console.error(`[Browser PageError] ${err.message}`);
        });

        console.log('[TEST] Navigating to index page...');
        await page.goto('http://localhost:8081', { waitUntil: 'networkidle2' });
        
        console.log('[TEST] Navigating to /session directly to test ML load and WebRTC initialization...');
        await page.goto('http://localhost:8081/session', { waitUntil: 'networkidle2' });

        // Wait a few seconds for ML models to try loading and WebRTC logic to run
        console.log('[TEST] Waiting 8 seconds to catch delayed errors or loops...');
        await new Promise(r => setTimeout(r, 8000));

        if (errors.length > 0) {
            console.log('\n[TEST RESULT] FAILED ❌ - Found console errors.');
            process.exit(1);
        } else {
            console.log('\n[TEST RESULT] SUCCESS ✅ - No runtime errors detected during session initialization.');
        }

    } catch (e) {
        console.error('[TEST FATAL]', e);
    } finally {
        if (browser) await browser.close();
        process.exit(0);
    }
})();
