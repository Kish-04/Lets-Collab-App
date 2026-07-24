const puppeteer = require('puppeteer');

(async () => {
    console.log('Starting puppeteer...');
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', error => console.log('BROWSER ERROR:', error.message));
    page.on('requestfailed', request => console.log('BROWSER REQUEST FAILED:', request.url(), request.failure().errorText));

    console.log('Navigating to app...');
    try {
        await page.goto('http://localhost:8081/session?create=true&mode=collaboration', { waitUntil: 'networkidle2' });
        console.log('Page loaded!');
    } catch (e) {
        console.error('Failed to load page:', e);
    }
    
    setTimeout(async () => {
        await browser.close();
    }, 5000);
})();
